import { connect, getBlockTimestampMs } from "@chain-analysis/chain";
import { loadConfig, createLogger, type Logger } from "@chain-analysis/config";
import { openDuckDb, writeBlockTimesBatch, type BlockTimeRow } from "@chain-analysis/storage";

type ChainId = "consensus" | "auto-evm";

export const startStreaming = async ({ chains }: { chains: ChainId[] }) => {
  const cfg = loadConfig();
  const logger = createLogger();
  const { conn } = openDuckDb(cfg.DATA_DIR);

  const runChain = async (chain: ChainId) => {
    const api = await connect(
      chain === "consensus" ? cfg.CONSENSUS_RPC_WS : (cfg.AUTO_EVM_RPC_WS ?? ""),
    );
    if (chain === "consensus") {
      await streamConsensus(api, logger, conn);
    } else {
      if (!cfg.AUTO_EVM_RPC_WS) {
        logger.warn("AUTO_EVM_RPC_WS not set; skipping auto-evm stream");
        return;
      }
      await streamAutoEvm(api, logger, conn);
    }
  };

  await Promise.all(chains.map((c) => runChain(c)));
};

const streamConsensus = async (api: any, logger: Logger, conn: any) => {
  const cfg = loadConfig();
  logger.info({ chain: "consensus" }, "starting stream");
  let last: { hash: string; ts: number } | null = null;
  const buffer: BlockTimeRow[] = [];
  let lastFlush = Date.now();

  const flush = async (force = false) => {
    const dueByCount = buffer.length >= cfg.WRITE_BATCH_ROWS;
    const dueByTime = Date.now() - lastFlush >= cfg.WRITE_BATCH_MS;
    if (!force && !dueByCount && !dueByTime) return;
    if (buffer.length === 0) return;
    const toWrite = buffer.splice(0, buffer.length);
    await writeBlockTimesBatch(conn, cfg.DATA_DIR, toWrite);
    logger.info({ count: toWrite.length, chain: "consensus" }, "flushed batch");
    lastFlush = Date.now();
  };

  await api.rpc.chain.subscribeNewHeads(async (head: any) => {
    const hash = head.hash.toHex();
    const parentHash = head.parentHash.toHex();
    const ts = await getBlockTimestampMs(api, hash);
    if (last && parentHash === last.hash) {
      const row: BlockTimeRow = {
        chain: "consensus",
        block_number: head.number.toNumber(),
        hash,
        parent_hash: parentHash,
        timestamp_ms: ts,
        delta_since_parent_ms: ts - last.ts,
        ingestion_ts_ms: Date.now(),
      };
      buffer.push(row);
      if (buffer.length >= cfg.WRITE_BATCH_ROWS || Date.now() - lastFlush >= cfg.WRITE_BATCH_MS) {
        await flush();
      }
    } else if (last && parentHash !== last.hash) {
      logger.warn(
        { last: last.hash, parentHash, hash, chain: "consensus" },
        "reorg edge detected; skipping delta",
      );
    }
    last = { hash, ts };
  });

  setInterval(() => void flush(false), 2000);
};

const streamAutoEvm = async (api: any, logger: Logger, conn: any) => {
  const cfg = loadConfig();
  logger.info({ chain: "auto-evm" }, "starting stream");
  let last: { hash: string; ts: number } | null = null;
  const buffer: BlockTimeRow[] = [];
  let lastFlush = Date.now();

  const flush = async (force = false) => {
    const dueByCount = buffer.length >= cfg.WRITE_BATCH_ROWS;
    const dueByTime = Date.now() - lastFlush >= cfg.WRITE_BATCH_MS;
    if (!force && !dueByCount && !dueByTime) return;
    if (buffer.length === 0) return;
    const toWrite = buffer.splice(0, buffer.length);
    await writeBlockTimesBatch(conn, cfg.DATA_DIR, toWrite);
    logger.info({ count: toWrite.length, chain: "auto-evm" }, "flushed batch");
    lastFlush = Date.now();
  };

  await api.rpc.chain.subscribeNewHeads(async (head: any) => {
    const hash = head.hash.toHex();
    const parentHash = head.parentHash.toHex();
    const ts = await getBlockTimestampMs(api, hash);
    if (last && parentHash === last.hash) {
      const row: BlockTimeRow = {
        chain: "auto-evm",
        block_number: head.number.toNumber(),
        hash,
        parent_hash: parentHash,
        timestamp_ms: ts,
        delta_since_parent_ms: ts - last.ts,
        ingestion_ts_ms: Date.now(),
      };
      buffer.push(row);
      if (buffer.length >= cfg.WRITE_BATCH_ROWS || Date.now() - lastFlush >= cfg.WRITE_BATCH_MS) {
        await flush();
      }
    } else if (last && parentHash !== last.hash) {
      logger.warn(
        { last: last.hash, parentHash, hash, chain: "auto-evm" },
        "reorg edge detected; skipping delta",
      );
    }
    last = { hash, ts };
  });

  setInterval(() => void flush(false), 2000);
};

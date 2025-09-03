import { loadConfig } from "@chain-analysis/config";
import { connect, getBlockTimestampMs } from "@chain-analysis/chain";
import {
  BlockTimeRow,
  openDuckDb,
  writeBlockTimesBatch,
} from "@chain-analysis/storage";
import pino from "pino";

const main = async () => {
  const cfg = loadConfig();
  const logger = pino({ level: cfg.LOG_LEVEL });

  logger.info({ cfg }, "starting consensus-stream");

  const api = await connect(cfg.CONSENSUS_RPC_WS);
  const { conn } = openDuckDb(cfg.DATA_DIR);

  let last: { hash: string; ts: number } | null = null;
  const buffer: BlockTimeRow[] = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    const toWrite = buffer.splice(0, buffer.length);
    await writeBlockTimesBatch(conn, cfg.DATA_DIR, toWrite);
    logger.info({ count: toWrite.length }, "flushed batch");
  };

  await api.rpc.chain.subscribeNewHeads(async (head) => {
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
      if (buffer.length >= 1000) {
        await flush();
      }
    } else if (last && parentHash !== last.hash) {
      logger.warn(
        { last: last.hash, parentHash, hash },
        "reorg edge detected; skipping delta"
      );
    }
    last = { hash, ts };
  });

  setInterval(() => void flush(), 2000);
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

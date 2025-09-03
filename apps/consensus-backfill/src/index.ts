import "dotenv/config";
import { connect, getBlockTimestampMs } from "@chain-analysis/chain";
import { loadConfig } from "@chain-analysis/config";
import { openDuckDb, writeBlockTimesBatch } from "@chain-analysis/storage";
import pino from "pino";

import type { BlockTimeRow } from "@chain-analysis/storage";

const main = async () => {
  const cfg = loadConfig();
  const logger = pino({ level: cfg.LOG_LEVEL });
  logger.info({ cfg }, "starting consensus-backfill");

  const api = await connect(cfg.CONSENSUS_RPC_WS);
  const { conn } = openDuckDb(cfg.DATA_DIR);

  const tipHeader = await api.rpc.chain.getHeader();
  const tipNumber = tipHeader.number.toNumber();
  const confirmedTip = tipNumber - cfg.K_CONSENSUS;
  const start = cfg.BACKFILL_START ?? Math.max(1, confirmedTip - 5000);
  const end = cfg.BACKFILL_END ?? confirmedTip;

  const buffer: BlockTimeRow[] = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    const toWrite = buffer.splice(0, buffer.length);
    await writeBlockTimesBatch(conn, cfg.DATA_DIR, toWrite);
    logger.info({ count: toWrite.length }, "flushed backfill batch");
  };

  let prevHash: string | null = null;
  let prevTs: number | null = null;
  for (let n = start; n <= end; n += 1) {
    const blockHash = await api.rpc.chain.getBlockHash(n);
    const header = await api.rpc.chain.getHeader(blockHash);
    const hash = header.hash.toHex();
    const parentHash = header.parentHash.toHex();
    const ts = await getBlockTimestampMs(api, hash);

    if (prevHash && parentHash !== prevHash) {
      logger.warn({ n, parentHash, prevHash }, "non-linear backfill step; skipping delta");
    } else if (prevHash && prevTs !== null) {
      buffer.push({
        chain: "consensus",
        block_number: n,
        hash,
        parent_hash: parentHash,
        timestamp_ms: ts,
        delta_since_parent_ms: ts - prevTs,
        ingestion_ts_ms: Date.now(),
      });
    }
    if (buffer.length >= cfg.WRITE_BATCH_ROWS) await flush();
    prevHash = hash;
    prevTs = ts;
  }
  await flush();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

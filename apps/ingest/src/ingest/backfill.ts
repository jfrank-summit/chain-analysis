import { connect, getBlockTimestampMs } from "@chain-analysis/chain";
import { loadConfig } from "@chain-analysis/config";
import {
  openDuckDb,
  writeBlockTimesBatch,
  type ConsensusBlockTimeRow,
  type AutoEvmBlockTimeRow,
} from "@chain-analysis/storage";
import pino from "pino";

import { enrichConsensusData } from "../chain/consensus/enrichment.js";
import { getConsensusBlockHash } from "../chain/domain/mapping.js";

type ChainId = "consensus" | "auto-evm";

export const runBackfill = async (opts: {
  chain: ChainId;
  start?: number;
  end?: number;
  K?: number;
}) => {
  const cfg = loadConfig();
  const logger = pino({ level: cfg.LOG_LEVEL });
  const { conn } = openDuckDb(cfg.DATA_DIR);

  const api = await connect(
    opts.chain === "consensus" ? cfg.CONSENSUS_RPC_WS : (cfg.AUTO_EVM_RPC_WS ?? ""),
  );
  if (opts.chain === "auto-evm" && !cfg.AUTO_EVM_RPC_WS) {
    logger.warn("AUTO_EVM_RPC_WS not set; skipping auto-evm backfill");
    return;
  }

  const tipHeader = await api.rpc.chain.getHeader();
  const tipNumber = tipHeader.number.toNumber();
  const k = opts.K ?? (opts.chain === "consensus" ? cfg.K_CONSENSUS : cfg.K_AUTO_EVM);
  const confirmedTip = tipNumber - k;
  const start = opts.start ?? cfg.BACKFILL_START ?? Math.max(1, confirmedTip - 5000);
  const end = opts.end ?? cfg.BACKFILL_END ?? confirmedTip;

  logger.info({ chain: opts.chain, start, end, k }, "starting backfill");

  const buffer: Array<ConsensusBlockTimeRow | AutoEvmBlockTimeRow> = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    const toWrite = buffer.splice(0, buffer.length);
    await writeBlockTimesBatch(conn, cfg.DATA_DIR, toWrite);
    logger.info({ count: toWrite.length, chain: opts.chain }, "flushed backfill batch");
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
      logger.warn(
        { n, parentHash, prevHash, chain: opts.chain },
        "non-linear backfill step; skipping delta",
      );
    } else if (prevHash && prevTs !== null) {
      if (opts.chain === "consensus") {
        const { containsSegmentHeaders, bundleCount } = await enrichConsensusData(api, hash);
        buffer.push({
          chain: "consensus",
          block_number: n,
          hash,
          parent_hash: parentHash,
          timestamp_ms: ts,
          delta_since_parent_ms: ts - prevTs,
          ingestion_ts_ms: Date.now(),
          contained_store_segment_headers: containsSegmentHeaders,
          bundle_count: bundleCount,
        });
      } else {
        const consensusHash = await getConsensusBlockHash(api, hash);
        buffer.push({
          chain: "auto-evm",
          block_number: n,
          hash,
          parent_hash: parentHash,
          timestamp_ms: ts,
          delta_since_parent_ms: ts - prevTs,
          ingestion_ts_ms: Date.now(),
          consensus_block_hash: consensusHash,
        });
      }
    }
    if (buffer.length >= cfg.WRITE_BATCH_ROWS) await flush();
    prevHash = hash;
    prevTs = ts;
  }
  await flush();
};

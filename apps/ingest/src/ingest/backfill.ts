import path from "node:path";

import { connect, getBlockTimestampMs, getTimestampFromExtrinsics } from "@chain-analysis/chain";
import { loadConfig, createLogger } from "@chain-analysis/config";
import {
  openDuckDb,
  writeBlockTimesBatch,
  type ConsensusBlockTimeRow,
  type AutoEvmBlockTimeRow,
} from "@chain-analysis/storage";

import { enrichConsensusData } from "../chain/consensus/enrichment.js";
import { enrichDomainData } from "../chain/domain/enrichment.js";

type ChainId = "consensus" | "auto-evm";

export const runBackfill = async (opts: {
  chain: ChainId;
  start?: number;
  end?: number;
  K?: number;
}) => {
  const cfg = loadConfig();
  const logger = createLogger();
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

  // Simple resume: if no explicit start, read max(block_number) from existing parquet and continue at max+1
  let resumeFrom: number | undefined;
  if (!(opts.start ?? cfg.BACKFILL_START)) {
    const pattern = path.resolve(
      cfg.DATA_DIR,
      `block_times/chain=${opts.chain}/date=*/part-*.parquet`,
    );
    const sql = `SELECT max(block_number) AS max_bn FROM read_parquet('${pattern.replace(/'/g, "''")}')`;
    try {
      const rows: Array<{ max_bn: number | bigint | null }> = await new Promise((resolve, reject) =>
        (conn as any).all(sql, (err: any, res: any) => (err ? reject(err) : resolve(res))),
      );
      const raw = rows?.[0]?.max_bn;
      const maxBn = raw == null ? null : typeof raw === "bigint" ? Number(raw) : Number(raw);
      if (maxBn != null && !Number.isNaN(maxBn)) {
        resumeFrom = maxBn + 1;
        logger.info({ chain: opts.chain, resumeFrom }, "resuming backfill");
      }
    } catch {
      // ignore: no files yet
    }
  }

  const buffer: Array<ConsensusBlockTimeRow | AutoEvmBlockTimeRow> = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    const toWrite = buffer.splice(0, buffer.length);
    await writeBlockTimesBatch(conn, cfg.DATA_DIR, toWrite);
    logger.info({ count: toWrite.length, chain: opts.chain }, "flushed backfill batch");
  };

  let prevHash: string | null = null;
  let prevTs: number | null = null;
  const effectiveStart = resumeFrom ?? start;
  if (effectiveStart > end) {
    logger.info({ chain: opts.chain, effectiveStart, end }, "nothing to backfill");
    return;
  }

  for (let n = effectiveStart; n <= end; n += 1) {
    const blockHash = await api.rpc.chain.getBlockHash(n);
    const block = await api.rpc.chain.getBlock(blockHash);
    const hash = blockHash.toHex();
    const parentHash = block.block.header.parentHash.toHex();
    const extrinsics = block.block.extrinsics as any[];
    const ts = getTimestampFromExtrinsics(extrinsics) ?? (await getBlockTimestampMs(api, hash));

    if (prevHash && parentHash !== prevHash) {
      logger.warn(
        { n, parentHash, prevHash, chain: opts.chain },
        "non-linear backfill step; skipping delta",
      );
    } else if (prevHash && prevTs !== null) {
      if (opts.chain === "consensus") {
        const at = await api.at(hash);
        const events = await at.query.system.events();
        const { containsSegmentHeaders, bundleCount } = await enrichConsensusData(api, hash, {
          events,
        });
        buffer.push({
          chain: "consensus",
          block_number: n,
          hash,
          parent_hash: parentHash,
          timestamp_ms: ts,
          timestamp_utc: new Date(ts).toISOString(),
          delta_since_parent_ms: ts - prevTs,
          ingestion_ts_ms: Date.now(),
          contained_store_segment_headers: containsSegmentHeaders,
          bundle_count: bundleCount,
        });
      } else {
        const header = block.block.header;
        const { consensusHash } = await enrichDomainData(api, hash, { header });
        buffer.push({
          chain: "auto-evm",
          block_number: n,
          hash,
          parent_hash: parentHash,
          timestamp_ms: ts,
          timestamp_utc: new Date(ts).toISOString(),
          delta_since_parent_ms: ts - prevTs,
          ingestion_ts_ms: Date.now(),
          consensus_block_hash: consensusHash,
        });
      }
    }
    if (n % 500 === 0)
      logger.info({ n, hash, parentHash, ts: new Date(ts).toISOString() }, "processed block");
    if (buffer.length >= cfg.WRITE_BATCH_ROWS) await flush();
    prevHash = hash;
    prevTs = ts;
  }
  await flush();
};

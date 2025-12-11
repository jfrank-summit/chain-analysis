import path from "node:path";

import { connect, getBlockTimestampMs, getTimestampFromExtrinsics } from "@chain-analysis/chain";
import { createLogger, loadConfig } from "@chain-analysis/config";
import {
  openDuckDb,
  writeOfflineOperatorsBatch,
  type OfflineOperatorEventRow,
} from "@chain-analysis/storage";

import {
  extractEpochCompletedEvents,
  extractOfflineOperatorEvents,
} from "../chain/consensus/offline-events.js";

export const runOfflineBackfill = async (opts: { start?: number; end?: number }) => {
  const cfg = loadConfig();
  const logger = createLogger();
  const { conn } = openDuckDb(cfg.DATA_DIR);

  const api = await connect(cfg.CONSENSUS_RPC_WS);

  const tipHeader = await api.rpc.chain.getHeader();
  const tipNumber = tipHeader.number.toNumber();
  const confirmedTip = tipNumber - cfg.K_CONSENSUS;

  const start = opts.start ?? cfg.BACKFILL_START ?? 1;
  const end = opts.end ?? cfg.BACKFILL_END ?? confirmedTip;

  logger.info({ start, end }, "starting offline operator backfill");

  // Resume support: check existing parquet files for max block_number
  let resumeFrom: number | undefined;
  if (!opts.start) {
    const pattern = path.resolve(cfg.DATA_DIR, "offline_operators/date=*/part-*.parquet");
    const sql = `SELECT max(block_number) AS max_bn FROM read_parquet('${pattern.replace(/'/g, "''")}')`;
    try {
      const rows: Array<{ max_bn: number | bigint | null }> = await new Promise((resolve, reject) =>
        (conn as any).all(sql, (err: any, res: any) => (err ? reject(err) : resolve(res))),
      );
      const raw = rows?.[0]?.max_bn;
      const maxBn = raw == null ? null : typeof raw === "bigint" ? Number(raw) : Number(raw);
      if (maxBn != null && !Number.isNaN(maxBn)) {
        resumeFrom = maxBn + 1;
        logger.info({ resumeFrom }, "resuming offline backfill");
      }
    } catch {
      // ignore: no files yet
    }
  }

  const effectiveStart = resumeFrom ?? start;
  if (effectiveStart > end) {
    logger.info({ effectiveStart, end }, "nothing to backfill");
    return;
  }

  const buffer: OfflineOperatorEventRow[] = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    const toWrite = buffer.splice(0, buffer.length);
    await writeOfflineOperatorsBatch(conn, cfg.DATA_DIR, toWrite);
    logger.info({ count: toWrite.length }, "flushed offline events batch");
  };

  let epochTransitionCount = 0;
  let offlineEventCount = 0;

  for (let n = effectiveStart; n <= end; n += 1) {
    const blockHash = await api.rpc.chain.getBlockHash(n);
    const hash = blockHash.toHex();
    const at = await api.at(hash);
    const events = await at.query.system.events();

    // Check for epoch transitions
    const epochEvents = extractEpochCompletedEvents(events);
    if (epochEvents.length === 0) {
      // Skip blocks without epoch transitions - log progress periodically
      if (n % 10000 === 0) {
        logger.info(
          { n, epochTransitions: epochTransitionCount, offlineEvents: offlineEventCount },
          "scanning",
        );
      }
      continue;
    }

    epochTransitionCount += epochEvents.length;

    // Get timestamp for this block
    const block = await api.rpc.chain.getBlock(blockHash);
    const extrinsics = block.block.extrinsics as any[];
    const ts = getTimestampFromExtrinsics(extrinsics) ?? (await getBlockTimestampMs(api, hash));

    // Extract offline events
    const offlineEvents = extractOfflineOperatorEvents(events);
    offlineEventCount += offlineEvents.length;

    for (const evt of offlineEvents) {
      // Find matching epoch for this domain
      const epochInfo = epochEvents.find((e) => e.domainId === evt.domainId);
      const epochIndex = epochInfo?.epochIndex ?? 0;

      const shortfall = evt.minRequiredBundles - evt.submittedBundles;
      const shortfallPct = evt.expectedBundles > 0 ? (shortfall / evt.expectedBundles) * 100 : 0;

      buffer.push({
        block_number: n,
        block_hash: hash,
        timestamp_ms: ts,
        timestamp_utc: new Date(ts).toISOString(),
        domain_id: evt.domainId,
        epoch_index: epochIndex,
        operator_id: evt.operatorId,
        submitted_bundles: evt.submittedBundles,
        expected_bundles: evt.expectedBundles,
        min_required_bundles: evt.minRequiredBundles,
        shortfall,
        shortfall_pct: shortfallPct,
        ingestion_ts_ms: Date.now(),
      });
    }

    logger.info(
      {
        n,
        epochTransitions: epochEvents.length,
        offlineEvents: offlineEvents.length,
        totalEpochs: epochTransitionCount,
        totalOffline: offlineEventCount,
      },
      "epoch transition block",
    );

    if (buffer.length >= 10) await flush();
  }

  await flush();
  logger.info(
    { epochTransitions: epochTransitionCount, offlineEvents: offlineEventCount },
    "offline operator backfill complete",
  );
};

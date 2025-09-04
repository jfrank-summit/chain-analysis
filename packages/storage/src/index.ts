import fs from "node:fs";
import path from "node:path";

import Database from "duckdb";

export type BlockTimeRow = {
  chain: string;
  block_number: number;
  hash: string;
  parent_hash: string;
  timestamp_ms: number;
  delta_since_parent_ms: number;
  ingestion_ts_ms: number;
};

export type ConsensusBlockTimeRow = BlockTimeRow & {
  contained_store_segment_headers: boolean;
  bundle_count: number;
};

export type AutoEvmBlockTimeRow = BlockTimeRow & {
  consensus_block_hash: string | null;
};

export const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

export const openDuckDb = (dataDir: string) => {
  ensureDir(dataDir);
  const dbPath = path.join(dataDir, "duckdb.db");
  const db = new Database.Database(dbPath);
  const conn = db.connect();
  return { db, conn };
};

export const writeBlockTimesBatch = async (
  conn: Database.Connection,
  dataDir: string,
  rows: BlockTimeRow[],
) => {
  if (rows.length === 0) return;
  const chain = rows[0].chain;
  const date = new Date(rows[0].timestamp_ms).toISOString().slice(0, 10);
  const outDir = path.join(dataDir, "block_times", `chain=${chain}`, `date=${date}`);
  ensureDir(outDir);

  const header = [
    "chain",
    "block_number",
    "hash",
    "parent_hash",
    "timestamp_ms",
    "delta_since_parent_ms",
    "ingestion_ts_ms",
  ].join(",");

  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csvLines = rows.map((r) =>
    [
      escape(r.chain),
      r.block_number,
      escape(r.hash),
      escape(r.parent_hash),
      r.timestamp_ms,
      r.delta_since_parent_ms,
      r.ingestion_ts_ms,
    ].join(","),
  );

  const tmpCsv = path.join(outDir, `.tmp-${process.pid}-${Date.now()}.csv`);
  const content = `${header}\n${csvLines.join("\n")}`;
  fs.writeFileSync(tmpCsv, content, { encoding: "utf8" });

  const outFile = path.join(outDir, `part-${Date.now()}.parquet`);
  try {
    const tmpCsvAbs = path.resolve(tmpCsv);
    const outFileAbs = path.resolve(outFile);
    const esc = (p: string) => p.replace(/'/g, "''");
    const sql = `COPY (SELECT * FROM read_csv_auto('${esc(tmpCsvAbs)}', HEADER=TRUE)) TO '${esc(outFileAbs)}' (FORMAT PARQUET)`;
    await new Promise<void>((resolve, reject) =>
      conn.run(sql, (err) => (err ? reject(err) : resolve())),
    );
  } finally {
    try {
      fs.unlinkSync(tmpCsv);
    } catch {
      // ignore
    }
  }
};

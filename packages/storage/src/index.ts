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
  const tmpTable = "tmp_block_times";
  const chain = rows[0].chain;
  const date = new Date(rows[0].timestamp_ms).toISOString().slice(0, 10);
  const outDir = path.join(dataDir, "block_times", `chain=${chain}`, `date=${date}`);
  ensureDir(outDir);

  await new Promise<void>((resolve, reject) =>
    conn.run(
      `CREATE OR REPLACE TEMP TABLE ${tmpTable} AS SELECT * FROM (
        SELECT * FROM read_json_auto(?)
      )`,
      [JSON.stringify(rows)],
      (err) => (err ? reject(err) : resolve()),
    ),
  );

  const outFile = path.join(outDir, `part-${Date.now()}.parquet`);
  await new Promise<void>((resolve, reject) =>
    conn.run(`COPY ${tmpTable} TO ? (FORMAT PARQUET)`, [outFile], (err) =>
      err ? reject(err) : resolve(),
    ),
  );
};

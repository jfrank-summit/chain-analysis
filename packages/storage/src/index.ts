import fs from "node:fs";
import path from "node:path";

import Database from "duckdb";

export type BlockTimeRow = {
  chain: string;
  block_number: number;
  hash: string;
  parent_hash: string;
  timestamp_ms: number;
  timestamp_utc: string;
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
  // Use an in-memory DuckDB instance; we only need it to run COPY/SELECT over files
  // and avoid cross-process file locking on a shared .db file.
  const db = new Database.Database(":memory:");
  const conn = db.connect();
  return { db, conn };
};

export const writeBlockTimesBatch = async (
  conn: Database.Connection,
  dataDir: string,
  rows: Array<BlockTimeRow | ConsensusBlockTimeRow | AutoEvmBlockTimeRow>,
) => {
  if (rows.length === 0) return;
  const chain = rows[0].chain;
  const date = new Date(rows[0].timestamp_ms).toISOString().slice(0, 10);
  const outDir = path.join(dataDir, "block_times", `chain=${chain}`, `date=${date}`);
  ensureDir(outDir);

  const headerCols = [
    "chain",
    "block_number",
    "hash",
    "parent_hash",
    "timestamp_ms",
    "timestamp_utc",
    "delta_since_parent_ms",
    "ingestion_ts_ms",
  ];
  if (chain === "consensus") {
    headerCols.push("contained_store_segment_headers", "bundle_count");
  } else if (chain === "auto-evm") {
    headerCols.push("consensus_block_hash");
  }
  const header = headerCols.join(",");

  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const csvLines = rows.map((r) => {
    const base = [
      escape(r.chain),
      (r as any).block_number,
      escape((r as any).hash),
      escape((r as any).parent_hash),
      (r as any).timestamp_ms,
      escape((r as any).timestamp_utc ?? new Date((r as any).timestamp_ms).toISOString()),
      (r as any).delta_since_parent_ms,
      (r as any).ingestion_ts_ms,
    ];
    if (chain === "consensus") {
      const contains = (r as any).contained_store_segment_headers ?? false;
      const bundles = (r as any).bundle_count ?? 0;
      base.push(String(contains), String(bundles));
    } else if (chain === "auto-evm") {
      const cHash = (r as any).consensus_block_hash ?? "";
      base.push(cHash ? escape(String(cHash)) : "");
    }
    return base.join(",");
  });

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

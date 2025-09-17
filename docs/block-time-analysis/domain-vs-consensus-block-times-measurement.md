## Measurement: Domain vs Consensus Block Times (DuckDB, Parquet)

- Paths assume data under `./data/block_times/chain=<chain>/date=*/part-*.parquet`.

Compute p, average consensus delta, implied domain delta, and observed domain delta (over the consensus window spanned by domain blocks):

```bash
duckdb -c "
INSTALL parquet; LOAD parquet;
WITH d AS (
  SELECT DISTINCT consensus_block_hash
  FROM read_parquet('./data/block_times/chain=auto-evm/date=*/part-*.parquet')
  WHERE consensus_block_hash IS NOT NULL
),
c AS (
  SELECT hash, block_number, delta_since_parent_ms
  FROM read_parquet('./data/block_times/chain=consensus/date=*/part-*.parquet')
),
bounds AS (
  SELECT min(c.block_number) AS min_bn, max(c.block_number) AS max_bn
  FROM c JOIN d ON d.consensus_block_hash = c.hash
),
cwin AS (
  SELECT * FROM c WHERE block_number BETWEEN (SELECT min_bn FROM bounds) AND (SELECT max_bn FROM bounds)
),
stats AS (
  SELECT count(*) AS total_consensus_blocks, avg(delta_since_parent_ms) AS avg_consensus_ms FROM cwin
),
p AS (
  SELECT (SELECT count(*) FROM d) * 1.0 / NULLIF((SELECT total_consensus_blocks FROM stats),0) AS p
),
domain_avg AS (
  SELECT avg(delta_since_parent_ms) AS avg_domain_ms
  FROM read_parquet('./data/block_times/chain=auto-evm/date=*/part-*.parquet')
  WHERE consensus_block_hash IS NOT NULL
)
SELECT stats.avg_consensus_ms,
       p.p,
       (stats.avg_consensus_ms / NULLIF(p.p,0)) AS implied_domain_ms,
       domain_avg.avg_domain_ms
FROM stats, p, domain_avg;
"
```

Hourly comparison of domain-connected vs. non-connected consensus blocks (helps spot period effects):

```bash
duckdb -c "
INSTALL parquet; LOAD parquet;
WITH d AS (
  SELECT DISTINCT consensus_block_hash
  FROM read_parquet('./data/block_times/chain=auto-evm/date=*/part-*.parquet')
  WHERE consensus_block_hash IS NOT NULL
), c AS (
  SELECT hash, timestamp_utc, delta_since_parent_ms
  FROM read_parquet('./data/block_times/chain=consensus/date=*/part-*.parquet')
)
SELECT grp, hour,
       avg(delta_since_parent_ms) AS avg_ms,
       quantile_cont(delta_since_parent_ms, 0.5) AS p50_ms
FROM (
  SELECT 'connected' AS grp, date_trunc('hour', CAST(c.timestamp_utc AS TIMESTAMP)) AS hour, c.delta_since_parent_ms
  FROM c JOIN d ON d.consensus_block_hash = c.hash
  UNION ALL
  SELECT 'not_connected' AS grp, date_trunc('hour', CAST(c.timestamp_utc AS TIMESTAMP)) AS hour, c.delta_since_parent_ms
  FROM c WHERE NOT EXISTS (SELECT 1 FROM d WHERE d.consensus_block_hash = c.hash)
) t
GROUP BY 1,2 ORDER BY 2,1;
"
```

Average of consensus blocks not associated with domain bundles (over the same consensus range):

```bash
duckdb -c "
INSTALL parquet; LOAD parquet;
WITH d AS (
  SELECT DISTINCT consensus_block_hash
  FROM read_parquet('./data/block_times/chain=auto-evm/date=*/part-*.parquet')
  WHERE consensus_block_hash IS NOT NULL
),
c AS (
  SELECT hash, block_number, delta_since_parent_ms
  FROM read_parquet('./data/block_times/chain=consensus/date=*/part-*.parquet')
),
bounds AS (
  SELECT min(c.block_number) AS min_bn, max(c.block_number) AS max_bn
  FROM c JOIN d ON d.consensus_block_hash = c.hash
),
consensus_in_range AS (
  SELECT c.hash, c.block_number, c.delta_since_parent_ms
  FROM c WHERE c.block_number BETWEEN (SELECT min_bn FROM bounds) AND (SELECT max_bn FROM bounds)
)
SELECT avg(delta_since_parent_ms) AS avg_ms
FROM consensus_in_range c
WHERE NOT EXISTS (SELECT 1 FROM d WHERE d.consensus_block_hash = c.hash);
"
```

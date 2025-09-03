-- Inspect counts and sample percentiles for consensus block times
INSTALL if not installed parquet;
LOAD parquet;

-- Adjust the path if DATA_DIR is different
SET global temp_directory='./data/tmp';

WITH t AS (
  SELECT * FROM read_parquet('data/block_times/chain=consensus/date=*/part-*.parquet')
)
SELECT
  count(*) AS rows,
  approx_quantile(delta_since_parent_ms, 0.5) AS p50_ms,
  approx_quantile(delta_since_parent_ms, 0.9) AS p90_ms,
  approx_quantile(delta_since_parent_ms, 0.99) AS p99_ms,
  mean(delta_since_parent_ms) AS mean_ms,
  stddev(delta_since_parent_ms) AS stddev_ms,
  max(delta_since_parent_ms) AS max_ms
FROM t;



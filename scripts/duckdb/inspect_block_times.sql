-- Inspect counts and sample percentiles for consensus block times
-- NOTE: On modern DuckDB versions Parquet is built-in; INSTALL is unnecessary.
-- If you are on an older version and need to install, run this once manually:
-- INSTALL parquet;
LOAD parquet;

-- Adjust the path if DATA_DIR is different
SET global temp_directory='./data/tmp';

-- Parameterized macro: pass NULL for optional start/end to disable the bound
CREATE OR REPLACE MACRO inspect_block_times(start_block, end_block) AS TABLE
WITH base AS (
  SELECT * FROM read_parquet('data/block_times/chain=consensus/date=*/part-*.parquet')
),
filtered AS (
  SELECT *
  FROM base
  WHERE (start_block IS NULL OR block_number >= start_block)
    AND (end_block IS NULL OR block_number <= end_block)
)
SELECT
  count(*) AS rows,
  approx_quantile(delta_since_parent_ms, 0.5) AS p50_ms,
  approx_quantile(delta_since_parent_ms, 0.9) AS p90_ms,
  approx_quantile(delta_since_parent_ms, 0.99) AS p99_ms,
  mean(delta_since_parent_ms) AS mean_ms,
  stddev(delta_since_parent_ms) AS stddev_ms,
  max(delta_since_parent_ms) AS max_ms
FROM filtered;

-- Default invocation: no bounds (both NULL)
SELECT * FROM inspect_block_times(NULL, NULL);


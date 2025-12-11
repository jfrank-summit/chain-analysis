-- Offline Operator Analysis Queries
-- NOTE: On modern DuckDB versions Parquet is built-in; INSTALL is unnecessary.
LOAD parquet;

SET global temp_directory='./data/tmp';

-- =============================================================================
-- BASIC STATISTICS
-- =============================================================================

-- Total offline events and unique operators affected
SELECT
  count(*) AS total_events,
  count(DISTINCT operator_id) AS unique_operators,
  count(DISTINCT domain_id) AS unique_domains,
  min(timestamp_utc) AS first_event,
  max(timestamp_utc) AS last_event
FROM read_parquet('data/offline_operators/date=*/part-*.parquet');

-- Events over time (daily)
SELECT
  date_trunc('day', timestamp_utc::timestamp) AS day,
  count(*) AS offline_events,
  count(DISTINCT operator_id) AS unique_operators,
  count(DISTINCT block_number) AS epoch_transitions
FROM read_parquet('data/offline_operators/date=*/part-*.parquet')
GROUP BY 1
ORDER BY 1;

-- =============================================================================
-- OPERATOR ANALYSIS
-- =============================================================================

-- Most frequently flagged operators
SELECT
  operator_id,
  count(*) AS times_flagged,
  avg(shortfall) AS avg_shortfall,
  avg(shortfall_pct) AS avg_shortfall_pct,
  sum(shortfall) AS total_shortfall,
  min(timestamp_utc) AS first_flagged,
  max(timestamp_utc) AS last_flagged
FROM read_parquet('data/offline_operators/date=*/part-*.parquet')
GROUP BY 1
ORDER BY 2 DESC;

-- Operator performance summary
SELECT
  operator_id,
  count(*) AS times_flagged,
  avg(submitted_bundles) AS avg_submitted,
  avg(expected_bundles) AS avg_expected,
  avg(min_required_bundles) AS avg_threshold,
  avg(submitted_bundles::float / NULLIF(expected_bundles, 0) * 100) AS avg_production_rate_pct
FROM read_parquet('data/offline_operators/date=*/part-*.parquet')
GROUP BY 1
ORDER BY times_flagged DESC;

-- =============================================================================
-- SEVERITY ANALYSIS
-- =============================================================================

-- Shortfall severity distribution
SELECT
  CASE
    WHEN shortfall_pct < 10 THEN '0-10% shortfall'
    WHEN shortfall_pct < 25 THEN '10-25% shortfall'
    WHEN shortfall_pct < 50 THEN '25-50% shortfall'
    WHEN shortfall_pct < 75 THEN '50-75% shortfall'
    ELSE '75%+ shortfall'
  END AS severity_bucket,
  count(*) AS event_count,
  round(count(*) * 100.0 / (SELECT count(*) FROM read_parquet('data/offline_operators/date=*/part-*.parquet')), 2) AS pct_of_total
FROM read_parquet('data/offline_operators/date=*/part-*.parquet')
GROUP BY 1
ORDER BY 1;

-- Submitted vs expected distribution
SELECT
  CASE
    WHEN submitted_bundles = 0 THEN '0 bundles (completely offline)'
    WHEN submitted_bundles < expected_bundles * 0.25 THEN '< 25% of expected'
    WHEN submitted_bundles < expected_bundles * 0.50 THEN '25-50% of expected'
    WHEN submitted_bundles < expected_bundles * 0.75 THEN '50-75% of expected'
    ELSE '75%+ of expected (marginal miss)'
  END AS production_bucket,
  count(*) AS event_count,
  avg(shortfall) AS avg_shortfall
FROM read_parquet('data/offline_operators/date=*/part-*.parquet')
GROUP BY 1
ORDER BY 1;

-- =============================================================================
-- THRESHOLD ANALYSIS
-- =============================================================================

-- How close are operators to the threshold when flagged?
SELECT
  shortfall AS bundles_below_threshold,
  count(*) AS occurrences
FROM read_parquet('data/offline_operators/date=*/part-*.parquet')
GROUP BY 1
ORDER BY 1;

-- Average threshold parameters
SELECT
  avg(expected_bundles) AS avg_expected,
  avg(min_required_bundles) AS avg_threshold,
  avg(expected_bundles - min_required_bundles) AS avg_buffer_size,
  avg((expected_bundles - min_required_bundles)::float / NULLIF(expected_bundles, 0) * 100) AS avg_buffer_pct
FROM read_parquet('data/offline_operators/date=*/part-*.parquet');

-- =============================================================================
-- TIME PATTERNS
-- =============================================================================

-- Events by hour of day (UTC)
SELECT
  extract(hour FROM timestamp_utc::timestamp) AS hour_of_day,
  count(*) AS offline_events,
  count(DISTINCT operator_id) AS unique_operators
FROM read_parquet('data/offline_operators/date=*/part-*.parquet')
GROUP BY 1
ORDER BY 1;

-- Rolling 7-day average
WITH daily_events AS (
  SELECT
    date_trunc('day', timestamp_utc::timestamp) AS day,
    count(*) AS daily_count
  FROM read_parquet('data/offline_operators/date=*/part-*.parquet')
  GROUP BY 1
)
SELECT
  day,
  daily_count,
  avg(daily_count) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS rolling_7d_avg
FROM daily_events
ORDER BY day;

-- =============================================================================
-- RECENT EVENTS
-- =============================================================================

-- Last 50 offline events
SELECT *
FROM read_parquet('data/offline_operators/date=*/part-*.parquet')
ORDER BY block_number DESC
LIMIT 50;

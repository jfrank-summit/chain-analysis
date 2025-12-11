# Measurement: Offline Operator Events (DuckDB, Parquet)

Paths assume data under `./data/offline_operators/date=*/part-*.parquet`.

## Quick Summary

Get overall statistics:

```bash
duckdb -c "
LOAD parquet;
SELECT
  count(*) AS total_events,
  count(DISTINCT operator_id) AS unique_operators,
  count(DISTINCT domain_id) AS unique_domains,
  min(timestamp_utc) AS first_event,
  max(timestamp_utc) AS last_event,
  avg(shortfall_pct) AS avg_shortfall_pct
FROM read_parquet('./data/offline_operators/date=*/part-*.parquet');
"
```

## Daily Event Counts

Track events over time:

```bash
duckdb -c "
LOAD parquet;
SELECT
  date_trunc('day', timestamp_utc::timestamp) AS day,
  count(*) AS offline_events,
  count(DISTINCT operator_id) AS unique_operators
FROM read_parquet('./data/offline_operators/date=*/part-*.parquet')
GROUP BY 1
ORDER BY 1;
"
```

## Operator Leaderboard

Most frequently flagged operators:

```bash
duckdb -c "
LOAD parquet;
SELECT
  operator_id,
  count(*) AS times_flagged,
  round(avg(shortfall_pct), 1) AS avg_shortfall_pct,
  round(avg(submitted_bundles), 0) AS avg_submitted,
  round(avg(expected_bundles), 0) AS avg_expected,
  min(timestamp_utc) AS first_flagged,
  max(timestamp_utc) AS last_flagged
FROM read_parquet('./data/offline_operators/date=*/part-*.parquet')
GROUP BY 1
ORDER BY 2 DESC;
"
```

## Severity Distribution

How severe are the shortfalls?

```bash
duckdb -c "
LOAD parquet;
WITH events AS (
  SELECT * FROM read_parquet('./data/offline_operators/date=*/part-*.parquet')
)
SELECT
  CASE
    WHEN submitted_bundles = 0 THEN '0 bundles (offline)'
    WHEN shortfall_pct < 10 THEN '< 10% shortfall'
    WHEN shortfall_pct < 25 THEN '10-25% shortfall'
    WHEN shortfall_pct < 50 THEN '25-50% shortfall'
    ELSE '50%+ shortfall'
  END AS severity,
  count(*) AS events,
  round(count(*) * 100.0 / (SELECT count(*) FROM events), 1) AS pct
FROM events
GROUP BY 1
ORDER BY 1;
"
```

## Marginal vs Severe Misses

Operators just barely missing vs significantly underperforming:

```bash
duckdb -c "
LOAD parquet;
SELECT
  CASE
    WHEN shortfall <= 2 THEN 'marginal (1-2 bundles)'
    WHEN shortfall <= 5 THEN 'moderate (3-5 bundles)'
    WHEN shortfall <= 10 THEN 'significant (6-10 bundles)'
    ELSE 'severe (10+ bundles)'
  END AS miss_category,
  count(*) AS events,
  avg(shortfall_pct) AS avg_shortfall_pct
FROM read_parquet('./data/offline_operators/date=*/part-*.parquet')
GROUP BY 1
ORDER BY 1;
"
```

## Time-of-Day Analysis

Check for time patterns (UTC):

```bash
duckdb -c "
LOAD parquet;
SELECT
  extract(hour FROM timestamp_utc::timestamp) AS hour_utc,
  count(*) AS events,
  count(DISTINCT operator_id) AS unique_operators
FROM read_parquet('./data/offline_operators/date=*/part-*.parquet')
GROUP BY 1
ORDER BY 1;
"
```

## Recent Events

Last 20 offline events:

```bash
duckdb -c "
LOAD parquet;
SELECT
  timestamp_utc,
  block_number,
  operator_id,
  submitted_bundles,
  expected_bundles,
  min_required_bundles,
  shortfall,
  shortfall_pct
FROM read_parquet('./data/offline_operators/date=*/part-*.parquet')
ORDER BY block_number DESC
LIMIT 20;
"
```

## Threshold Analysis

Are thresholds set appropriately?

```bash
duckdb -c "
LOAD parquet;
SELECT
  round(avg(expected_bundles), 1) AS avg_expected,
  round(avg(min_required_bundles), 1) AS avg_threshold,
  round(avg(expected_bundles - min_required_bundles), 1) AS avg_buffer,
  round(avg((expected_bundles - min_required_bundles)::float / NULLIF(expected_bundles, 0) * 100), 1) AS avg_buffer_pct
FROM read_parquet('./data/offline_operators/date=*/part-*.parquet');
"
```

## Full Analysis Script

Run all queries from the scripts folder:

```bash
duckdb < scripts/duckdb/offline_operators.sql
```

#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<USAGE
Usage: $(basename "$0") [--start N] [--end N] [--chain consensus|auto-evm]

Options (all optional):
  --start N     Inclusive starting block number filter
  --end N       Inclusive ending block number filter
  --chain NAME  Chain to inspect (default: consensus)

Env:
  DATA_DIR      Base data directory (default: <repo>/data)

Examples:
  $(basename "$0")
  $(basename "$0") --start 100000 --end 200000
  $(basename "$0") --chain consensus --start 1 --end 10000
USAGE
}

START=""
END=""
CHAIN="consensus"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start)
      [[ $# -ge 2 ]] || { echo "--start requires a value" >&2; exit 1; }
      START="$2"; shift 2 ;;
    --end)
      [[ $# -ge 2 ]] || { echo "--end requires a value" >&2; exit 1; }
      END="$2"; shift 2 ;;
    --chain)
      [[ $# -ge 2 ]] || { echo "--chain requires a value" >&2; exit 1; }
      CHAIN="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1 ;;
  esac
done

# Basic validation for numeric inputs if provided
if [[ -n "$START" && ! "$START" =~ ^[0-9]+$ ]]; then
  echo "--start must be an integer" >&2; exit 1
fi
if [[ -n "$END" && ! "$END" =~ ^[0-9]+$ ]]; then
  echo "--end must be an integer" >&2; exit 1
fi

# Resolve repo root and data dir
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR_DEFAULT="$REPO_ROOT/data"
DATA_DIR="${DATA_DIR:-$DATA_DIR_DEFAULT}"

# Make DATA_DIR absolute if it's relative
if [[ "$DATA_DIR" != /* ]]; then
  DATA_DIR="$REPO_ROOT/$DATA_DIR"
fi

PARQUET_GLOB="$DATA_DIR/block_times/chain=$CHAIN/date=*/part-*.parquet"

WHERE_CLAUSES=( )
if [[ -n "$START" ]]; then WHERE_CLAUSES+=("block_number >= $START"); fi
if [[ -n "$END" ]]; then WHERE_CLAUSES+=("block_number <= $END"); fi

WHERE_CLAUSE=""
if [[ ${#WHERE_CLAUSES[@]} -gt 0 ]]; then
  for clause in "${WHERE_CLAUSES[@]}"; do
    if [[ -z "$WHERE_CLAUSE" ]]; then
      WHERE_CLAUSE="$clause"
    else
      WHERE_CLAUSE="$WHERE_CLAUSE AND $clause"
    fi
  done
else
  WHERE_CLAUSE="1=1"
fi

SQL=$(cat <<EOF
LOAD parquet;
WITH base AS (
  SELECT * FROM read_parquet('$PARQUET_GLOB')
),
filtered AS (
  SELECT *
  FROM base
  WHERE $WHERE_CLAUSE
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
EOF
)

duckdb -c "$SQL" | cat



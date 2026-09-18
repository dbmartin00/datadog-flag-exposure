#!/bin/bash
# Runs flags.js repeatedly with a delay between runs.
# Usage: ./run-flags.sh [runs] [delay_seconds]
set -euo pipefail

RUNS="${1:-100}"
DELAY="${2:-1}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for i in $(seq 1 "$RUNS"); do
  echo "=== run $i/$RUNS ==="
  node "$DIR/flags.js"
  sleep "$DELAY"
done

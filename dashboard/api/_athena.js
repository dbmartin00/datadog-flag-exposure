import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
} from '@aws-sdk/client-athena';

const client = new AthenaClient({
  region: process.env.AWS_REGION || 'us-west-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const DATABASE = 'playtime';
const OUTPUT_LOCATION = `s3://${process.env.EXPOSURE_S3_BUCKET}/athena-results/`;
const POLL_INTERVAL_MS = 300;
const POLL_TIMEOUT_MS = 45000;

export function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

const RANGE_MS = {
  '20m': 20 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

export function buildTimeFilter(range) {
  const ms = RANGE_MS[range];
  if (!ms) return '1=1';
  return `"timestamp" >= ${Date.now() - ms}`;
}

export function buildEnvFilter(env) {
  if (!env || env === 'all') return '1=1';
  return `env = '${escapeSqlString(env)}'`;
}

const GROWTH_BUCKETS = 24;

// Buckets each targetingKey's first-seen time (within the current filter) into
// GROWTH_BUCKETS intervals and returns a running cumulative count per bucket.
// `count` is the number of keys first seen in that bucket; the frontend treats
// a zero count as "no growth" and breaks the line there rather than drawing a
// flat segment through it.
export function bucketTargetingKeyGrowth(rows, range) {
  const firstSeenTimes = rows
    .map((r) => r.firstseen ?? r.firstSeen)
    .filter((v) => v != null)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (firstSeenTimes.length === 0) return [];

  const rangeEnd = Date.now();
  const ms = RANGE_MS[range];
  const rangeStart = ms ? rangeEnd - ms : firstSeenTimes[0];
  const bucketSize = (rangeEnd - rangeStart) / GROWTH_BUCKETS;
  if (bucketSize <= 0) return [];

  const counts = new Array(GROWTH_BUCKETS).fill(0);
  for (const t of firstSeenTimes) {
    if (t < rangeStart) continue;
    const idx = Math.min(GROWTH_BUCKETS - 1, Math.max(0, Math.floor((t - rangeStart) / bucketSize)));
    counts[idx] += 1;
  }

  let cumulative = 0;
  return counts.map((count, i) => {
    cumulative += count;
    return { bucketStart: Math.round(rangeStart + i * bucketSize), count, cumulative };
  });
}

const FORECAST_BUCKETS = 24;
export const PMFCR_TARGET = 1_000_000;

function startOfCurrentMonthMs() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
}

// pMFCR resets monthly (the 1st, UTC) and is otherwise monotonically
// increasing. Buckets this month's pMFCR=1 timestamps into a cumulative
// series, fits a simple linear regression over it (x centered on the mean
// for numerical stability), and — if the trend is actually rising — projects
// the timestamp at which cumulative pMFCR would cross PMFCR_TARGET.
export function buildPmfcrForecast(rows) {
  const monthStart = startOfCurrentMonthMs();
  const now = Date.now();

  const times = rows
    .map((r) => r.timestamp ?? r['timestamp'])
    .filter((v) => v != null)
    .map(Number)
    .filter((t) => Number.isFinite(t) && t >= monthStart)
    .sort((a, b) => a - b);

  if (times.length === 0) {
    return { buckets: [], currentTotal: 0, forecastTimestamp: null, monthStart, target: PMFCR_TARGET };
  }

  // Bucket from the first real event this month, not the literal calendar start —
  // otherwise a long dead zone before activity existed dilutes the "current rate"
  // regression and wastes most of the chart's resolution on flat zeros.
  const activeStart = times[0];
  const bucketSize = Math.max(1, (now - activeStart) / FORECAST_BUCKETS);
  const counts = new Array(FORECAST_BUCKETS).fill(0);
  for (const t of times) {
    const idx = Math.min(FORECAST_BUCKETS - 1, Math.max(0, Math.floor((t - activeStart) / bucketSize)));
    counts[idx] += 1;
  }

  let cumulative = 0;
  const buckets = counts.map((count, i) => {
    cumulative += count;
    return { bucketStart: Math.round(activeStart + i * bucketSize), cumulative };
  });

  const n = buckets.length;
  const meanX = buckets.reduce((s, b) => s + b.bucketStart, 0) / n;
  const meanY = buckets.reduce((s, b) => s + b.cumulative, 0) / n;
  let num = 0;
  let den = 0;
  for (const b of buckets) {
    const dx = b.bucketStart - meanX;
    num += dx * (b.cumulative - meanY);
    den += dx * dx;
  }
  const slope = den === 0 ? 0 : num / den; // pMFCR per millisecond

  const currentTotal = buckets[buckets.length - 1].cumulative;
  let forecastTimestamp = null;
  if (slope > 0 && currentTotal < PMFCR_TARGET) {
    forecastTimestamp = Math.round(meanX + (PMFCR_TARGET - meanY) / slope);
  }

  return { buckets, slope, currentTotal, forecastTimestamp, monthStart, target: PMFCR_TARGET };
}

export async function runAthenaQuery(sql) {
  const { QueryExecutionId } = await client.send(
    new StartQueryExecutionCommand({
      QueryString: sql,
      QueryExecutionContext: { Database: DATABASE },
      ResultConfiguration: { OutputLocation: OUTPUT_LOCATION },
    })
  );

  const start = Date.now();
  let state;
  do {
    const { QueryExecution } = await client.send(
      new GetQueryExecutionCommand({ QueryExecutionId })
    );
    state = QueryExecution.Status.State;
    if (state === 'FAILED' || state === 'CANCELLED') {
      throw new Error(QueryExecution.Status.StateChangeReason || `Query ${state}`);
    }
    if (state !== 'SUCCEEDED') {
      if (Date.now() - start > POLL_TIMEOUT_MS) {
        throw new Error('Athena query timed out');
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } while (state !== 'SUCCEEDED');

  const rows = [];
  let columns;
  let nextToken;
  do {
    const result = await client.send(
      new GetQueryResultsCommand({ QueryExecutionId, NextToken: nextToken })
    );
    if (!columns) {
      columns = result.ResultSet.ResultSetMetadata.ColumnInfo.map((c) => c.Name);
    }
    const resultRows = result.ResultSet.Rows;
    const startIdx = nextToken ? 0 : 1; // first page's row 0 is the header
    for (let i = startIdx; i < resultRows.length; i++) {
      const data = resultRows[i].Data.map((d) => d.VarCharValue ?? null);
      const row = {};
      columns.forEach((col, idx) => {
        row[col] = data[idx];
      });
      rows.push(row);
    }
    nextToken = result.NextToken;
  } while (nextToken);

  return rows;
}

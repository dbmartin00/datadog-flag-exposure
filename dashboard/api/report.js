import {
  runAthenaQuery,
  buildTimeFilter,
  buildEnvFilter,
  escapeSqlString,
  bucketTargetingKeyGrowth,
  buildPmfcrForecast,
} from './_athena.js';

// Hobby plan's max allowed function duration — Athena cold starts (fresh
// query planning, no cached results) can otherwise exceed the 10s default.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const { metric, range = 'all', env = 'all', flag, targetingKey } = req.query;
  const timeFilter = buildTimeFilter(range);
  const envFilter = buildEnvFilter(env);

  let sql;
  switch (metric) {
    case 'environments':
      sql = `SELECT DISTINCT env FROM playtime.exposures ORDER BY env`;
      break;

    case 'topFlags':
      sql = `SELECT flag, COUNT(*) AS n FROM playtime.exposures
             WHERE ${timeFilter} AND ${envFilter}
             GROUP BY flag ORDER BY n DESC`;
      break;

    case 'flagValueBreakdown':
      if (!flag) return res.status(400).json({ error: 'flag is required' });
      sql = `SELECT value, COUNT(*) AS n FROM playtime.exposures
             WHERE flag = '${escapeSqlString(flag)}' AND ${timeFilter} AND ${envFilter}
             GROUP BY value ORDER BY n DESC`;
      break;

    case 'uniqueTargetingKeys':
      sql = `SELECT COUNT(DISTINCT targetingKey) AS n FROM playtime.exposures
             WHERE ${timeFilter} AND ${envFilter}`;
      break;

    case 'pmfcr':
      sql = `SELECT COALESCE(SUM(pMFCR), 0) AS n FROM playtime.exposures
             WHERE ${timeFilter} AND ${envFilter}`;
      break;

    case 'variationTypeSplit':
      sql = `SELECT variationType, COUNT(*) AS n FROM playtime.exposures
             WHERE ${timeFilter} AND ${envFilter}
             GROUP BY variationType ORDER BY n DESC`;
      break;

    case 'targetingKeyGrowth':
      sql = `SELECT targetingKey, MIN("timestamp") AS firstSeen FROM playtime.exposures
             WHERE ${timeFilter} AND ${envFilter}
             GROUP BY targetingKey`;
      break;

    case 'pmfcrForecast':
      // Deliberately ignores the range dropdown — this always covers month-to-date,
      // since pMFCR resets monthly.
      sql = `SELECT "timestamp" FROM playtime.exposures WHERE pMFCR = 1 AND ${envFilter}`;
      break;

    case 'deploymentEvents':
      // Not time-filtered server-side (same pattern as pmfcrForecast) — each of the
      // three consuming charts clips to its own visible x-domain client-side, since
      // they each show a different window.
      sql = `SELECT service, env, version, started_at, finished_at, change_failure, team, git, custom_tags
             FROM playtime.deployments
             WHERE ${envFilter}
             ORDER BY finished_at ASC`;
      break;

    case 'targetingKeyLookup':
      if (!targetingKey) return res.status(400).json({ error: 'targetingKey is required' });
      sql = `SELECT flag, value, "timestamp", variationType FROM playtime.exposures
             WHERE targetingKey = '${escapeSqlString(targetingKey)}' AND ${timeFilter} AND ${envFilter}
             ORDER BY "timestamp" DESC`;
      break;

    default:
      return res.status(400).json({ error: `Unknown metric: ${metric}` });
  }

  try {
    const rawRows = await runAthenaQuery(sql);
    let rows;
    if (metric === 'targetingKeyGrowth') {
      rows = bucketTargetingKeyGrowth(rawRows, range);
    } else if (metric === 'pmfcrForecast') {
      rows = [buildPmfcrForecast(rawRows)];
    } else {
      rows = rawRows;
    }
    res.status(200).json({ rows });
  } catch (err) {
    console.error('Athena query failed', err);
    res.status(500).json({ error: err.message || 'Query failed' });
  }
}

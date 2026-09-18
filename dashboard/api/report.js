import { runAthenaQuery, buildTimeFilter, buildEnvFilter, escapeSqlString } from './_athena.js';

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

    case 'variationTypeSplit':
      sql = `SELECT variationType, COUNT(*) AS n FROM playtime.exposures
             WHERE ${timeFilter} AND ${envFilter}
             GROUP BY variationType ORDER BY n DESC`;
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
    const rows = await runAthenaQuery(sql);
    res.status(200).json({ rows });
  } catch (err) {
    console.error('Athena query failed', err);
    res.status(500).json({ error: err.message || 'Query failed' });
  }
}

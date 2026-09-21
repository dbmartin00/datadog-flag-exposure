import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import GrowthChart from './GrowthChart';
import ForecastChart from './ForecastChart';
import TargetingKeyTimeline from './TargetingKeyTimeline';

const RANGES = [
  { value: '20m', label: 'Last 20 minutes' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '4h', label: 'Last 4 hours' },
  { value: '1d', label: 'Last 1 day' },
  { value: 'all', label: 'All time' },
];

async function fetchReport(metric, params = {}, signal) {
  const qs = new URLSearchParams({ metric, ...params });
  const res = await fetch(`/api/report?${qs.toString()}`, { signal });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body.rows;
}

function formatTimestamp(value) {
  if (!value) return '';
  return new Date(Number(value)).toLocaleString();
}

function App() {
  const [range, setRange] = useState('1h');
  const [env, setEnv] = useState('all');
  const [environments, setEnvironments] = useState([]);

  const [topFlags, setTopFlags] = useState([]);
  const [selectedFlag, setSelectedFlag] = useState(null);
  const [flagBreakdown, setFlagBreakdown] = useState([]);

  const [uniqueCount, setUniqueCount] = useState(null);
  const [pmfcrCount, setPmfcrCount] = useState(null);
  const [variationSplit, setVariationSplit] = useState([]);
  const [growth, setGrowth] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [deployments, setDeployments] = useState([]);

  const [targetingKeyInput, setTargetingKeyInput] = useState('');
  const [targetingKeyResults, setTargetingKeyResults] = useState(null);
  const [targetingKeyError, setTargetingKeyError] = useState(null);
  const [targetingKeyLoading, setTargetingKeyLoading] = useState(false);
  const targetingKeyAbortRef = useRef(null);

  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const abortControllerRef = useRef(null);

  function onError(err) {
    if (err.name === 'AbortError') return; // superseded by a newer refresh — not a real failure
    setError(err.message);
  }

  useEffect(() => {
    fetchReport('environments').then((rows) => setEnvironments(rows.map((r) => r.env).filter(Boolean)), onError);
  }, []);

  const refresh = useCallback(() => {
    // Cancel any still-in-flight requests from a previous refresh (e.g. rapid dropdown
    // changes) instead of just ignoring their results — two concurrent requests for the
    // exact same URL (like pmfcrForecast, which doesn't vary by range) can otherwise
    // leave one fetch permanently unresolved and hang Promise.allSettled forever.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { signal } = controller;

    setError(null);
    setSelectedFlag(null);
    setFlagBreakdown([]);
    setLoading(true);

    const requests = [
      fetchReport('topFlags', { range, env }, signal).then(setTopFlags, onError),
      fetchReport('uniqueTargetingKeys', { range, env }, signal).then((rows) => setUniqueCount(rows[0]?.n ?? '0'), onError),
      fetchReport('pmfcr', { range, env }, signal).then((rows) => setPmfcrCount(rows[0]?.n ?? '0'), onError),
      fetchReport('variationTypeSplit', { range, env }, signal).then(setVariationSplit, onError),
      fetchReport('targetingKeyGrowth', { range, env }, signal).then(setGrowth, onError),
      // Deliberately not passing `range` — pMFCR forecast is always month-to-date.
      fetchReport('pmfcrForecast', { env }, signal).then((rows) => setForecast(rows[0]), onError),
      // Deliberately not passing `range` — each chart clips deploy events to its own visible domain.
      fetchReport('deploymentEvents', { env }, signal).then(
        // Athena returns every value as a string ("false"/"true"), which is truthy
        // either way in JS — normalize to a real boolean here, once, for every consumer.
        (rows) => setDeployments(rows.map((r) => ({ ...r, change_failure: r.change_failure === 'true', finished_at: Number(r.finished_at) }))),
        onError
      ),
    ];

    Promise.allSettled(requests).then(() => {
      if (abortControllerRef.current === controller) setLoading(false);
    });
  }, [range, env]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function selectFlag(flag) {
    setSelectedFlag(flag);
    fetchReport('flagValueBreakdown', { range, env, flag }).then(setFlagBreakdown, (err) => setError(err.message));
  }

  function lookupTargetingKey(e) {
    e.preventDefault();
    const key = targetingKeyInput.trim();
    if (!key) return;

    // Cancel a still-in-flight previous lookup instead of leaving it to race
    // with this one (same hazard as the main refresh() batch — see its comment).
    targetingKeyAbortRef.current?.abort();
    const controller = new AbortController();
    targetingKeyAbortRef.current = controller;

    setTargetingKeyError(null);
    setTargetingKeyResults(null);
    setTargetingKeyLoading(true);

    fetchReport('targetingKeyLookup', { range, env, targetingKey: key }, controller.signal)
      .then(setTargetingKeyResults, (err) => {
        if (err.name === 'AbortError') return;
        setTargetingKeyError(err.message);
      })
      .finally(() => {
        if (targetingKeyAbortRef.current === controller) setTargetingKeyLoading(false);
      });
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Flag Exposure Dashboard</h1>
        <div className="filters">
          {loading && <span className="spinner" role="status" aria-label="Loading" />}
          <label>
            Time range
            <select value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <label>
            Environment
            <select value={env} onChange={(e) => setEnv(e.target.value)}>
              <option value="all">All</option>
              {environments.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className={`panels${loading ? ' panels-loading' : ''}`}>
        <section className="panel">
          <h2>Top flags</h2>
          <table>
            <thead><tr><th>Flag</th><th>Exposures</th></tr></thead>
            <tbody>
              {topFlags.map((row) => (
                <tr
                  key={row.flag}
                  className={`clickable-row${row.flag === selectedFlag ? ' selected' : ''}`}
                  onClick={() => selectFlag(row.flag)}
                >
                  <td>{row.flag}</td>
                  <td>{row.n}</td>
                </tr>
              ))}
              {topFlags.length === 0 && <tr><td colSpan={2}>No data</td></tr>}
            </tbody>
          </table>
          {selectedFlag && (
            <div className="drilldown">
              <h3>Values for &quot;{selectedFlag}&quot;</h3>
              <table>
                <thead><tr><th>Value</th><th>Count</th></tr></thead>
                <tbody>
                  {flagBreakdown.map((row, i) => (
                    <tr key={i}><td>{row.value}</td><td>{row.n}</td></tr>
                  ))}
                  {flagBreakdown.length === 0 && <tr><td colSpan={2}>No data</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Unique targeting keys</h2>
          <p className="big-number">{uniqueCount ?? '…'}</p>
          <h2 className="stat-label">pMFCR (SDK initializations)</h2>
          <p className="big-number">{pmfcrCount ?? '…'}</p>
          <img src="/datadog-logo.png" alt="Datadog" className="panel-logo" />
        </section>

        <section className="panel panel-wide">
          <h2>Distinct targeting keys over time</h2>
          <GrowthChart data={growth} range={range} deployments={deployments} />
        </section>

        <section className="panel panel-wide">
          <h2>pMFCR forecast (month-to-date)</h2>
          {forecast ? <ForecastChart data={forecast} deployments={deployments} /> : <p className="chart-empty">Loading…</p>}
        </section>

        <section className="panel">
          <h2>Split by variation type</h2>
          <table>
            <thead><tr><th>Variation type</th><th>Exposures</th></tr></thead>
            <tbody>
              {variationSplit.map((row) => (
                <tr key={row.variationtype ?? row.variationType}>
                  <td>{row.variationtype ?? row.variationType}</td>
                  <td>{row.n}</td>
                </tr>
              ))}
              {variationSplit.length === 0 && <tr><td colSpan={2}>No data</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="panel panel-wide">
          <h2>Look up a targeting key</h2>
          <form onSubmit={lookupTargetingKey} className="lookup-form">
            <input
              type="text"
              placeholder="targetingKey"
              value={targetingKeyInput}
              onChange={(e) => setTargetingKeyInput(e.target.value)}
            />
            <button type="submit" disabled={targetingKeyLoading}>Look up</button>
            {targetingKeyLoading && <span className="spinner" role="status" aria-label="Loading" />}
          </form>
          {targetingKeyError && <div className="error-banner">{targetingKeyError}</div>}
          {targetingKeyResults?.length > 0 && (
            <TargetingKeyTimeline rows={targetingKeyResults} range={range} deployments={deployments} />
          )}
          {targetingKeyResults && (
            <table>
              <thead><tr><th>Flag</th><th>Value</th><th>Variation type</th><th>Timestamp</th></tr></thead>
              <tbody>
                {targetingKeyResults.map((row, i) => {
                  const variationType = row.variationtype ?? row.variationType;
                  const isBoolean = variationType === 'boolean';
                  return (
                    <tr key={i}>
                      <td>
                        <a
                          href="https://app.datadoghq.com/feature-flags"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flag-link"
                        >
                          {row.flag}
                        </a>
                      </td>
                      <td style={isBoolean ? { color: row.value === 'true' ? '#3987e5' : '#e66767' } : undefined}>
                        {row.value}
                      </td>
                      <td>{variationType}</td>
                      <td>{formatTimestamp(row.timestamp)}</td>
                    </tr>
                  );
                })}
                {targetingKeyResults.length === 0 && <tr><td colSpan={4}>No exposures found</td></tr>}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;

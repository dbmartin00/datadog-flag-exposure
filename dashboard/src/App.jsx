import { useCallback, useEffect, useState } from 'react';
import './App.css';

const RANGES = [
  { value: '20m', label: 'Last 20 minutes' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '4h', label: 'Last 4 hours' },
  { value: '1d', label: 'Last 1 day' },
  { value: 'all', label: 'All time' },
];

async function fetchReport(metric, params = {}) {
  const qs = new URLSearchParams({ metric, ...params });
  const res = await fetch(`/api/report?${qs.toString()}`);
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
  const [variationSplit, setVariationSplit] = useState([]);

  const [targetingKeyInput, setTargetingKeyInput] = useState('');
  const [targetingKeyResults, setTargetingKeyResults] = useState(null);
  const [targetingKeyError, setTargetingKeyError] = useState(null);

  const [error, setError] = useState(null);

  useEffect(() => {
    fetchReport('environments').then(
      (rows) => setEnvironments(rows.map((r) => r.env).filter(Boolean)),
      (err) => setError(err.message)
    );
  }, []);

  const refresh = useCallback(() => {
    setError(null);
    setSelectedFlag(null);
    setFlagBreakdown([]);
    fetchReport('topFlags', { range, env }).then(setTopFlags, (err) => setError(err.message));
    fetchReport('uniqueTargetingKeys', { range, env }).then(
      (rows) => setUniqueCount(rows[0]?.n ?? '0'),
      (err) => setError(err.message)
    );
    fetchReport('variationTypeSplit', { range, env }).then(setVariationSplit, (err) => setError(err.message));
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
    setTargetingKeyError(null);
    setTargetingKeyResults(null);
    const key = targetingKeyInput.trim();
    if (!key) return;
    fetchReport('targetingKeyLookup', { range, env, targetingKey: key }).then(
      setTargetingKeyResults,
      (err) => setTargetingKeyError(err.message)
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>DataDog Flag Exposure Dashboard</h1>
        <div className="filters">
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

      <div className="panels">
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

        <section className="panel">
          <h2>Look up a targeting key</h2>
          <form onSubmit={lookupTargetingKey} className="lookup-form">
            <input
              type="text"
              placeholder="targetingKey"
              value={targetingKeyInput}
              onChange={(e) => setTargetingKeyInput(e.target.value)}
            />
            <button type="submit">Look up</button>
          </form>
          {targetingKeyError && <div className="error-banner">{targetingKeyError}</div>}
          {targetingKeyResults && (
            <table>
              <thead><tr><th>Flag</th><th>Value</th><th>Variation type</th><th>Timestamp</th></tr></thead>
              <tbody>
                {targetingKeyResults.map((row, i) => (
                  <tr key={i}>
                    <td>{row.flag}</td>
                    <td>{row.value}</td>
                    <td>{row.variationtype ?? row.variationType}</td>
                    <td>{formatTimestamp(row.timestamp)}</td>
                  </tr>
                ))}
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

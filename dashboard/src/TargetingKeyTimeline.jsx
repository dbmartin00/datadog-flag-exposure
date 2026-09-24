import { useMemo, useRef, useState } from 'react';
import { projectDeployMarkers, clusterDeployMarkers, nearestDeployCluster } from './deployMarkerUtils';
import DeployMarkers from './DeployMarkers';
import DeployTooltip from './DeployTooltip';
import { githubFlagSearchUrl } from './flagLinks';

const WIDTH = 640;
const PAD = { top: 12, right: 16, bottom: 28, left: 120 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const LANE_HEIGHT = 28;
const DOT_COLOR = '#3987e5'; // same "exposure" identity color as GrowthChart
const BOOL_TRUE_COLOR = '#3987e5';
const BOOL_FALSE_COLOR = '#e66767'; // same red used for deploy failures
const SURFACE_COLOR = '#1a1a1a';

function dotColor(row) {
  // Athena is inconsistent about column-name casing across different queries
  // (this lookup's result comes back as "variationType", while other metrics
  // return "variationtype") — check both rather than assume one.
  const variationType = row.variationtype ?? row.variationType;
  if (variationType === 'boolean') {
    return row.value === 'true' ? BOOL_TRUE_COLOR : BOOL_FALSE_COLOR;
  }
  return DOT_COLOR;
}
const RANGE_MS = { '20m': 1_200_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };
const FALLBACK_SPAN_MS = 86_400_000;

// One targetingKey's own exposures all fire within milliseconds of each other
// (one flags.js run evaluates a handful of flags back-to-back), so a domain
// scoped tightly to just its own timestamps would be a useless single dot
// cluster. Reuse the dashboard's globally-selected range instead, so the dots
// sit in a wide, meaningful window comparable against deploy lines.
function computeDomain(rows, deployments, range) {
  const now = Date.now();
  if (RANGE_MS[range]) return [now - RANGE_MS[range], now];
  const times = [...rows.map((r) => Number(r.timestamp)), ...deployments.map((d) => d.finished_at)].filter(
    Number.isFinite
  );
  const earliest = times.length ? Math.min(...times) : now - FALLBACK_SPAN_MS;
  return [Math.min(earliest, now - FALLBACK_SPAN_MS), now];
}

export default function TargetingKeyTimeline({ rows, range, deployments = [] }) {
  const containerRef = useRef(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const [domainStart, domainEnd] = useMemo(
    () => computeDomain(rows, deployments, range),
    [rows, deployments, range]
  );
  const xOf = (t) =>
    domainEnd > domainStart ? PAD.left + ((t - domainStart) / (domainEnd - domainStart)) * PLOT_W : PAD.left;

  const flags = useMemo(() => [...new Set(rows.map((r) => r.flag))].sort(), [rows]);
  const laneOf = useMemo(() => Object.fromEntries(flags.map((f, i) => [f, i])), [flags]);
  const height = PAD.top + PAD.bottom + Math.max(1, flags.length) * LANE_HEIGHT;

  const points = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        t: Number(r.timestamp),
        x: xOf(Number(r.timestamp)),
        y: PAD.top + laneOf[r.flag] * LANE_HEIGHT + LANE_HEIGHT / 2,
      })),
    [rows, laneOf, domainStart, domainEnd]
  );

  const deployMarkers = useMemo(
    () => projectDeployMarkers(deployments, xOf, domainStart, domainEnd),
    [deployments, domainStart, domainEnd]
  );
  const deployClusters = useMemo(() => clusterDeployMarkers(deployMarkers), [deployMarkers]);

  function handleMove(e) {
    const rect = containerRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const relY = ((e.clientY - rect.top) / rect.height) * height;
    const cluster = nearestDeployCluster(deployClusters, relX);
    if (cluster) {
      setHoverInfo({ kind: 'deploy', ...cluster });
    } else {
      let best = null;
      let bestDist = Infinity;
      for (const p of points) {
        if (Math.abs(p.x - relX) > 10 || Math.abs(p.y - relY) > LANE_HEIGHT / 2) continue;
        const dist = Math.hypot(p.x - relX, p.y - relY);
        if (dist < bestDist) {
          bestDist = dist;
          best = p;
        }
      }
      setHoverInfo(best ? { kind: 'point', ...best } : null);
    }
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  if (!rows.length) return null; // the table already shows "No exposures found"

  return (
    <div className="growth-chart" ref={containerRef}>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Exposures for this targeting key over time">
        {flags.map((f, i) => {
          const y = PAD.top + i * LANE_HEIGHT + LANE_HEIGHT / 2;
          const url = githubFlagSearchUrl(f);
          const label = (
            <text x={PAD.left - 8} y={y} className="chart-axis-label" textAnchor="end" dominantBaseline="middle">
              {f}
            </text>
          );
          return (
            <g key={f}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className="chart-gridline" />
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="flag-link-svg">
                  {label}
                </a>
              ) : (
                label
              )}
            </g>
          );
        })}

        <text x={PAD.left} y={height - 6} className="chart-axis-label">
          {new Date(domainStart).toLocaleString()}
        </text>
        <text x={WIDTH - PAD.right} y={height - 6} className="chart-axis-label" textAnchor="end">
          {new Date(domainEnd).toLocaleString()}
        </text>

        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={5} fill={dotColor(p)} stroke={SURFACE_COLOR} strokeWidth={1.5} />
        ))}

        <DeployMarkers clusters={deployClusters} top={PAD.top} bottom={height - PAD.bottom} />

        <rect
          x={PAD.left}
          y={PAD.top}
          width={PLOT_W}
          height={height - PAD.top - PAD.bottom}
          fill="transparent"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverInfo(null)}
        />

        {hoverInfo && (
          <line x1={hoverInfo.x} x2={hoverInfo.x} y1={PAD.top} y2={height - PAD.bottom} className="chart-crosshair" />
        )}
      </svg>

      {hoverInfo?.kind === 'point' && (
        <div className="chart-tooltip" style={{ left: Math.min(tooltipPos.x + 12, WIDTH - 170), top: tooltipPos.y }}>
          <strong>{hoverInfo.flag}</strong> = {hoverInfo.value}
          <div className="chart-tooltip-sub">
            {hoverInfo.variationtype ?? hoverInfo.variationType} · {new Date(hoverInfo.t).toLocaleString()}
          </div>
        </div>
      )}

      {hoverInfo?.kind === 'deploy' && (
        <DeployTooltip cluster={hoverInfo} style={{ left: Math.min(tooltipPos.x + 12, WIDTH - 170), top: tooltipPos.y }} />
      )}
    </div>
  );
}

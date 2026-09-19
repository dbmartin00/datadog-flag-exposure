import { useMemo, useRef, useState } from 'react';

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 28, left: 56 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const LINE_COLOR = 'rgb(134, 112, 78)'; // same dull gold used for pMFCR elsewhere in the UI
const SURFACE_COLOR = '#1a1a1a';
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatAxisLabel(ms, includeTime) {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  if (!includeTime) return date;
  return `${date} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export default function ForecastChart({ data }) {
  const containerRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const { buckets, slope, currentTotal, forecastTimestamp, target } = data;

  const now = Date.now();
  const hasForecast = typeof slope === 'number' && slope > 0 && forecastTimestamp;
  const tooFarOut = hasForecast && forecastTimestamp - now > TEN_YEARS_MS;

  // Scale the chart off the actual observed bucket span (first real event to now),
  // not the literal calendar month start — the buckets themselves are already
  // anchored to the first real event, so the axes need to match that.
  const activeStart = buckets[0]?.bucketStart ?? now;
  const lastBucket = buckets[buckets.length - 1];
  const shortWindow = now - activeStart < 2 * 24 * 60 * 60 * 1000;

  // Extend the visible window by the same span already observed, so the trend's
  // direction reads clearly without forcing the y-axis all the way to 1,000,000
  // (which would flatten the actual data into invisibility at current volumes).
  const extendedEnd = hasForecast ? now + (now - activeStart) : now;
  const extrapolatedY =
    hasForecast && lastBucket ? lastBucket.cumulative + slope * (extendedEnd - lastBucket.bucketStart) : null;

  const maxY = useMemo(
    () => niceMax(Math.max(currentTotal || 0, extrapolatedY || 0, 1)),
    [currentTotal, extrapolatedY]
  );
  const maxX = hasForecast ? extendedEnd : now;

  const xOf = (t) => PAD.left + ((t - activeStart) / (maxX - activeStart)) * PLOT_W;
  const yOf = (v) => PAD.top + PLOT_H - (v / maxY) * PLOT_H;

  const points = useMemo(
    () => buckets.map((b) => ({ ...b, x: xOf(b.bucketStart), y: yOf(b.cumulative) })),
    [buckets, maxX, maxY, activeStart]
  );

  const yTicks = [0, maxY / 2, maxY];

  function handleMove(e) {
    const rect = containerRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const idx = Math.round(((relX - PAD.left) / PLOT_W) * (points.length - 1));
    const clamped = Math.min(points.length - 1, Math.max(0, idx));
    setHoverIndex(clamped);
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  if (!buckets.length) {
    return <p className="chart-empty">No pMFCR events yet this month</p>;
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="growth-chart" ref={containerRef}>
      <p className="forecast-headline">
        {hasForecast && !tooFarOut && (
          <>
            Projected to reach <strong>{target.toLocaleString()}</strong> pMFCR on{' '}
            <span className="forecast-date">{formatDate(forecastTimestamp)}</span>
          </>
        )}
        {hasForecast && tooFarOut && (
          <>At the current rate, reaching {target.toLocaleString()} pMFCR would take more than 10 years — not on pace this month.</>
        )}
        {!hasForecast && <>Not enough upward trend this month to project a {target.toLocaleString()} pMFCR date.</>}
      </p>
      <p className="forecast-substat">{currentTotal.toLocaleString()} pMFCR so far this month</p>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Cumulative pMFCR this month with trend projection">
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yOf(t)} y2={yOf(t)} className="chart-gridline" />
            <text x={PAD.left - 8} y={yOf(t)} className="chart-axis-label" textAnchor="end" dominantBaseline="middle">
              {Math.round(t).toLocaleString()}
            </text>
          </g>
        ))}

        {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((idx, i) => (
          <text
            key={i}
            x={points[idx].x}
            y={HEIGHT - 6}
            className="chart-axis-label"
            textAnchor={idx === 0 ? 'start' : idx === points.length - 1 ? 'end' : 'middle'}
          >
            {formatAxisLabel(points[idx].bucketStart, shortWindow)}
          </text>
        ))}

        <path
          d={points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
          fill="none"
          stroke={LINE_COLOR}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {hasForecast && lastBucket && extrapolatedY !== null && (
          <line
            x1={xOf(lastBucket.bucketStart)}
            y1={yOf(lastBucket.cumulative)}
            x2={xOf(extendedEnd)}
            y2={yOf(extrapolatedY)}
            stroke={LINE_COLOR}
            strokeWidth={2}
            strokeOpacity={0.45}
            strokeDasharray="5 5"
            strokeLinecap="round"
          />
        )}

        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={5} fill={LINE_COLOR} stroke={SURFACE_COLOR} strokeWidth={2} />

        <rect x={PAD.left} y={PAD.top} width={PLOT_W} height={PLOT_H} fill="transparent" onMouseMove={handleMove} onMouseLeave={() => setHoverIndex(null)} />

        {hovered && <line x1={hovered.x} x2={hovered.x} y1={PAD.top} y2={PAD.top + PLOT_H} className="chart-crosshair" />}
      </svg>

      {hovered && (
        <div className="chart-tooltip" style={{ left: Math.min(tooltipPos.x + 12, WIDTH - 170), top: tooltipPos.y }}>
          <strong>{hovered.cumulative.toLocaleString()}</strong> total
          <div className="chart-tooltip-sub">{formatDate(hovered.bucketStart)}</div>
        </div>
      )}
    </div>
  );
}

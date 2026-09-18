import { useMemo, useRef, useState } from 'react';

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 28, left: 44 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const LINE_COLOR = '#3987e5'; // dataviz reference palette: sequential blue, dark step 400
const SURFACE_COLOR = '#1a1a1a'; // matches .panel background, for marker rings

function formatBucketLabel(ms, range) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (range === '1d' || range === 'all') {
    const date = d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
    return `${date} ${time}`;
  }
  return time;
}

function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export default function GrowthChart({ data, range }) {
  const containerRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const maxY = useMemo(() => niceMax(data.length ? data[data.length - 1].cumulative : 0), [data]);

  const points = useMemo(
    () =>
      data.map((d, i) => ({
        x: PAD.left + (data.length > 1 ? (i / (data.length - 1)) * PLOT_W : PLOT_W / 2),
        y: PAD.top + PLOT_H - (d.cumulative / maxY) * PLOT_H,
        displayValue: d.count === 0 ? null : d.cumulative,
        ...d,
      })),
    [data, maxY]
  );

  const segments = useMemo(() => {
    const segs = [];
    let current = [];
    for (const p of points) {
      if (p.displayValue === null) {
        if (current.length) segs.push(current);
        current = [];
      } else {
        current.push(p);
      }
    }
    if (current.length) segs.push(current);
    return segs;
  }, [points]);

  const yTicks = [0, maxY / 2, maxY];

  function handleMove(e) {
    const rect = containerRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const idx = Math.round(((relX - PAD.left) / PLOT_W) * (points.length - 1));
    const clamped = Math.min(points.length - 1, Math.max(0, idx));
    setHoverIndex(clamped);
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  if (!data.length) {
    return <p className="chart-empty">No data</p>;
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="growth-chart" ref={containerRef}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Cumulative distinct targeting keys over time">
        {yTicks.map((t, i) => {
          const y = PAD.top + PLOT_H - (t / maxY) * PLOT_H;
          return (
            <g key={i}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className="chart-gridline" />
              <text x={PAD.left - 8} y={y} className="chart-axis-label" textAnchor="end" dominantBaseline="middle">
                {Math.round(t)}
              </text>
            </g>
          );
        })}

        {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((idx, i) => (
          <text
            key={i}
            x={points[idx].x}
            y={HEIGHT - 6}
            className="chart-axis-label"
            textAnchor={idx === 0 ? 'start' : idx === points.length - 1 ? 'end' : 'middle'}
          >
            {formatBucketLabel(points[idx].bucketStart, range)}
          </text>
        ))}

        {segments.map((seg, i) =>
          seg.length > 1 ? (
            <path
              key={i}
              d={seg.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
              fill="none"
              stroke={LINE_COLOR}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <circle key={i} cx={seg[0].x} cy={seg[0].y} r={4} fill={LINE_COLOR} />
          )
        )}

        {points.length > 0 && points[points.length - 1].displayValue !== null && (
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r={5}
            fill={LINE_COLOR}
            stroke={SURFACE_COLOR}
            strokeWidth={2}
          />
        )}

        <rect
          x={PAD.left}
          y={PAD.top}
          width={PLOT_W}
          height={PLOT_H}
          fill="transparent"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
        />

        {hovered && (
          <line
            x1={hovered.x}
            x2={hovered.x}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            className="chart-crosshair"
          />
        )}
      </svg>

      {hovered && (
        <div
          className="chart-tooltip"
          style={{ left: Math.min(tooltipPos.x + 12, WIDTH - 150), top: tooltipPos.y }}
        >
          <strong>{hovered.cumulative}</strong> total
          <div className="chart-tooltip-sub">
            {hovered.count > 0 ? `+${hovered.count} new` : 'no growth'} · {formatBucketLabel(hovered.bucketStart, range)}
          </div>
        </div>
      )}
    </div>
  );
}

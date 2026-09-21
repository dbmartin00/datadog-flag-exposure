const GOLD = 'rgb(131, 113, 83)';
const RED = '#e66767';

export default function DeployMarkers({ clusters, top, bottom }) {
  return clusters.map((c) => {
    const mixed = c.hasFailure && c.hasSuccess;
    const color = c.hasFailure ? RED : GOLD;
    const count = c.items.length;
    const bold = count > 1;

    return (
      <g key={c.x}>
        {mixed ? (
          <>
            <line
              x1={c.x} x2={c.x} y1={top} y2={bottom}
              stroke={GOLD} strokeWidth={3.5} strokeDasharray="4 4" pointerEvents="none"
            />
            <line
              x1={c.x} x2={c.x} y1={top} y2={bottom}
              stroke={RED} strokeWidth={3.5} strokeDasharray="4 4" strokeDashoffset={4} pointerEvents="none"
            />
          </>
        ) : (
          <line
            x1={c.x} x2={c.x} y1={top} y2={bottom}
            stroke={color} strokeWidth={bold ? 3.5 : 1.5} strokeDasharray="4 3" pointerEvents="none"
          />
        )}
        <circle
          cx={c.x} cy={top} r={bold ? 5 : 3.5}
          fill={mixed ? GOLD : color}
          stroke={mixed ? RED : 'none'}
          strokeWidth={mixed ? 2 : 0}
        />
        {bold && (
          <text x={c.x} y={top - 6} textAnchor="middle" className="chart-axis-label">
            ×{count}
          </text>
        )}
      </g>
    );
  });
}

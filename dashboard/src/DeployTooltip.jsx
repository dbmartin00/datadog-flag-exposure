import { deployMarkerColor } from './deployMarkerUtils';

export default function DeployTooltip({ cluster, style }) {
  return (
    <div className="chart-tooltip" style={style}>
      {cluster.items.map((d, i) => (
        <div
          key={i}
          className="chart-tooltip-deploy-item"
          style={{ borderLeft: `3px solid ${deployMarkerColor(d)}`, paddingLeft: '0.5rem', marginTop: i > 0 ? '0.5rem' : 0 }}
        >
          <strong>{d.change_failure ? '✕ Failed' : '✓ Success'} deploy · {d.service}</strong>
          <div className="chart-tooltip-sub">
            {d.env} · {d.version} · {new Date(d.finished_at).toLocaleString()}
            {d.team && <> · team {d.team}</>}
          </div>
          {d.git && (() => {
            const g = JSON.parse(d.git);
            return <div className="chart-tooltip-sub">{g.commit_sha?.slice(0, 7)} · {g.repository_url}</div>;
          })()}
          {d.custom_tags && <div className="chart-tooltip-sub">{JSON.parse(d.custom_tags).join(', ')}</div>}
        </div>
      ))}
    </div>
  );
}

export function deployMarkerColor(m) {
  return m.change_failure ? '#e66767' : 'rgb(131, 113, 83)';
}

// Clips deploy events to a chart's own visible domain and projects each into
// that chart's screen space via its own xOf(timestamp) — every chart keeps its
// own scale/padding, this just does the shared clip+project math.
export function projectDeployMarkers(deployments, xOf, domainStart, domainEnd) {
  return deployments
    .filter((d) => d.finished_at >= domainStart && d.finished_at <= domainEnd)
    .map((d) => ({ ...d, x: xOf(d.finished_at) }));
}

// Deploys fired close together in real time can project to nearly the same
// pixel at wide zoom levels, where one would otherwise silently paint over
// the other. Group markers within pixelThreshold of each other so the caller
// can render "more than one happened here" instead of just the last one.
export function clusterDeployMarkers(markers, pixelThreshold = 3) {
  const sorted = [...markers].sort((a, b) => a.x - b.x);
  const clusters = [];
  for (const m of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && m.x - last.x <= pixelThreshold) {
      last.items.push(m);
      last.x = last.items.reduce((sum, i) => sum + i.x, 0) / last.items.length;
    } else {
      clusters.push({ x: m.x, items: [m] });
    }
  }
  return clusters.map((c) => ({
    ...c,
    hasFailure: c.items.some((i) => i.change_failure),
    hasSuccess: c.items.some((i) => !i.change_failure),
  }));
}

export function nearestDeployCluster(clusters, x, pixelThreshold = 6) {
  let best = null;
  let bestDist = Infinity;
  for (const c of clusters) {
    const dist = Math.abs(c.x - x);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best && bestDist <= pixelThreshold ? best : null;
}

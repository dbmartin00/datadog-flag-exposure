export function githubFlagSearchUrl(flag) {
  const repo = import.meta.env.VITE_GITHUB_REPO;
  if (!repo) return null;
  const params = new URLSearchParams({ q: `repo:${repo} ${flag}`, type: 'code' });
  return `https://github.com/search?${params.toString()}`;
}

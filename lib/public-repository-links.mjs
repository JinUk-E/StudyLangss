// Public visitors must never depend on the server owner's GitHub credentials.
export function createPublicRepositoryFilter({ fetchImpl = fetch, now = Date.now, timeoutMs = 2000 } = {}) {
  const cache = new Map(), pending = new Map();
  async function visibleLink(value) {
    if (!value) return value;
    let url;
    try { url = new URL(value); } catch { return ''; }
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return value;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return value; // Account profiles are not repositories.
    let owner, repository;
    try { owner = decodeURIComponent(parts[0]); repository = decodeURIComponent(parts[1]).replace(/\.git$/i, ''); }
    catch { return ''; }
    if (!/^[a-z\d-]+$/i.test(owner) || !/^[a-z\d_.-]+$/i.test(repository) || ['.', '..'].includes(repository)) return '';
    const key = `${owner}/${repository}`.toLowerCase();
    const saved = cache.get(key);
    if (saved && saved.expires > now()) return saved.visible ? value : '';
    if (!pending.has(key)) {
      const lookup = (async () => {
        let visible = false, lifetime = 30000;
        try {
          const response = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'StarlightForge-Portfolio' },
            redirect: 'error', signal: AbortSignal.timeout(timeoutMs)
          });
          if (response.status === 200) {
            const data = await response.json();
            visible = data.private === false && data.full_name?.toLowerCase() === key;
            lifetime = 10 * 60 * 1000;
          } else {
            await response.body?.cancel();
            if (response.status === 404) lifetime = 10 * 60 * 1000;
          }
        } catch { /* An unavailable or ambiguous result stays hidden. */ }
        if (cache.size >= 256) cache.delete(cache.keys().next().value);
        cache.set(key, { visible, expires: now() + lifetime });
        return visible;
      })();
      pending.set(key, lookup);
      lookup.finally(() => pending.delete(key));
    }
    return await pending.get(key) ? value : '';
  }
  return async function publicLinks(data) {
    const [profile, projects] = await Promise.all([
      (async () => ({ ...data.profile, githubUrl: await visibleLink(data.profile.githubUrl), contactUrl: await visibleLink(data.profile.contactUrl) }))(),
      Promise.all(data.projects.map(async project => {
        const [repository, link] = await Promise.all([visibleLink(project.repository), visibleLink(project.link)]);
        return { ...project, repository, link };
      }))
    ]);
    return { ...data, profile, projects };
  };
}

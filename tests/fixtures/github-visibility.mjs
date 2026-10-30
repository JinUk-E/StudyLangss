// Deterministic upstream for the real portfolio server's HTTP integration tests.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://api.github.com') return originalFetch(url, options);
  const full_name = decodeURIComponent(parsed.pathname.slice('/repos/'.length));
  const privateRepository = full_name.toLowerCase().endsWith('/private-project');
  return Response.json({ full_name, private: privateRepository });
};

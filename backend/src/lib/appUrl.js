/**
 * The single public website URL to put in emails / links.
 *
 * CLIENT_URL is a COMMA-SEPARATED allow-list used for CORS (e.g.
 * "http://localhost:3000,http://localhost:3001,https://team.example.com"), so it
 * must NOT be used as a link base directly. This picks ONE clean origin: an
 * explicit PUBLIC_APP_URL if set, else the production https origin from the list,
 * else any non-localhost, else the first entry.
 */
export function publicAppUrl() {
  const explicit = (process.env.PUBLIC_APP_URL || process.env.APP_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const list = (process.env.CLIENT_URL || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  const isLocal = (u) => /localhost|127\.0\.0\.1/i.test(u);
  const pick =
    list.find((u) => /^https:\/\//i.test(u) && !isLocal(u)) || // a real production origin
    list.find((u) => !isLocal(u)) || // any non-localhost
    list[0] ||
    'http://localhost:3000';
  return pick.replace(/\/+$/, '');
}

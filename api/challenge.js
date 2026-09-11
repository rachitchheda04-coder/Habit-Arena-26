// Vercel server-side proxy. Only this file sees the Apps Script secret.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  const source = process.env.CHALLENGE_FEED_URL;
  const token = process.env.CHALLENGE_API_TOKEN;
  if (!source || !token) return res.status(503).json({error:'Sheet connection not configured'});
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com') throw new Error('Invalid upstream');
    url.searchParams.set('token', token);
    const response = await fetch(url, {signal:AbortSignal.timeout(10000), redirect:'follow'});
    if (!response.ok) throw new Error('Upstream unavailable');
    const payload = await response.json();
    if (payload.schemaVersion !== '1.0' || !Array.isArray(payload.entries)) throw new Error('Invalid payload');
    return res.status(200).json(payload);
  } catch {
    // Never log the URL or return upstream errors: they may contain the secret.
    return res.status(502).json({error:'Sheet temporarily unavailable'});
  }
}

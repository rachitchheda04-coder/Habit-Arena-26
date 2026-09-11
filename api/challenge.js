export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const source = process.env.CHALLENGE_FEED_URL;
  const token = process.env.CHALLENGE_API_TOKEN;

  if (!source || !token) {
    return res.status(503).json({
      error: 'Environment variables missing',
      hasFeedUrl: !!source,
      hasToken: !!token
    });
  }

  let url;

  try {
    url = new URL(source.trim());
  } catch {
    return res.status(500).json({
      error: 'CHALLENGE_FEED_URL is not a valid URL'
    });
  }

  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com') {
    return res.status(500).json({
      error: 'Unexpected feed URL',
      hostname: url.hostname
    });
  }

  url.searchParams.set('token', token.trim());

  let response;

  try {
    response = await fetch(url, {
      redirect: 'follow'
    });
  } catch (error) {
    return res.status(502).json({
      error: 'Vercel could not fetch Apps Script',
      type: error?.name || 'Unknown'
    });
  }

  const text = await response.text();

  if (!response.ok) {
    return res.status(502).json({
      error: 'Apps Script returned an HTTP error',
      status: response.status,
      contentType: response.headers.get('content-type')
    });
  }

  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    return res.status(502).json({
      error: 'Apps Script response was not JSON',
      status: response.status,
      contentType: response.headers.get('content-type'),
      preview: text.slice(0, 100)
    });
  }

  if (payload.error) {
    return res.status(502).json({
      error: 'Apps Script returned an error',
      upstreamError: payload.error
    });
  }

  if (payload.schemaVersion !== '1.0') {
    return res.status(502).json({
      error: 'Wrong schema version',
      received: payload.schemaVersion
    });
  }

  if (!Array.isArray(payload.entries)) {
    return res.status(502).json({
      error: 'Entries is not an array'
    });
  }

  return res.status(200).json(payload);
}

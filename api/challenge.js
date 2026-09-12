// Habit Arena Vercel proxy: keeps the Apps Script token server-side and
// lets Vercel serve a fast recent snapshot while the upstream refreshes.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  const source = process.env.CHALLENGE_FEED_URL?.trim();
  const token = process.env.CHALLENGE_API_TOKEN?.trim();

  if (!source || !token) {
    return res.status(503).json({
      error: 'Sheet connection not configured'
    });
  }

  try {
    const url = new URL(source);

    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'script.google.com'
    ) {
      throw new Error('Invalid upstream');
    }

    url.searchParams.set('token', token);

    // Avoid the AbortSignal.timeout issue we saw earlier.
    const response = await fetch(url, {
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error('Upstream unavailable');
    }

    const payload = await response.json();

    if (
      payload?.schemaVersion !== '1.0' ||
      !Array.isArray(payload.entries)
    ) {
      throw new Error('Invalid payload');
    }

    // Repeat opens can use Vercel's recent cached copy instead of
    // waking Google Apps Script every single time.
    //
    // Fresh for 20 seconds.
    // After that, Vercel may serve the old copy immediately while
    // refreshing it in the background for up to 5 minutes.
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=20, stale-while-revalidate=300'
    );

    return res.status(200).json(payload);

  } catch {
    res.setHeader('Cache-Control', 'no-store');

    return res.status(502).json({
      error: 'Sheet temporarily unavailable'
    });
  }
}

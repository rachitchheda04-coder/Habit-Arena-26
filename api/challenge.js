// Habit Arena live-data proxy.
// Goal: serve the last good Sheet snapshot instantly from Vercel's CDN,
// while refreshing Google Apps Script in the background.

let memoryPayload = null;
let memorySavedAt = 0;

function setLiveCacheHeaders(res) {
  // The browser may reuse a very recent response for a few seconds.
  res.setHeader(
    'Cache-Control',
    'public, max-age=10, stale-while-revalidate=60'
  );

  // Keep the last good snapshot available at Vercel's edge.
  // After 30 seconds it can be served instantly while Vercel refreshes it.
  res.setHeader(
    'CDN-Cache-Control',
    'public, max-age=30, stale-while-revalidate=86400, stale-if-error=86400'
  );

  res.setHeader(
    'Vercel-CDN-Cache-Control',
    'public, max-age=30, stale-while-revalidate=86400, stale-if-error=86400'
  );
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  const source = process.env.CHALLENGE_FEED_URL?.trim();
  const token = process.env.CHALLENGE_API_TOKEN?.trim();

  if (!source || !token) {
    res.setHeader('Cache-Control', 'no-store');

    return res.status(503).json({
      error: 'Sheet connection not configured'
    });
  }

  // If this Vercel function instance already has fresh data,
  // return it immediately instead of calling Google again.
  if (
    memoryPayload &&
    Date.now() - memorySavedAt < 20_000
  ) {
    setLiveCacheHeaders(res);

    res.setHeader(
      'X-Habit-Arena-Source',
      'memory'
    );

    return res
      .status(200)
      .json(memoryPayload);
  }

  try {
    const url = new URL(source);

    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'script.google.com'
    ) {
      throw new Error('Invalid upstream');
    }

    url.searchParams.set(
      'token',
      token
    );

    // Give Apps Script enough time to wake up on a cold request.
    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      45_000
    );

    let response;

    try {
      response = await fetch(
        url,
        {
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            Accept: 'application/json'
          }
        }
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(
        `Upstream unavailable (${response.status})`
      );
    }

    const payload =
      await response.json();

    // Basic safety check so broken Sheet data
    // never reaches the frontend.
    if (
      payload?.schemaVersion !== '1.0' ||
      !payload.challenge ||
      !Array.isArray(payload.participants) ||
      !Array.isArray(payload.habits) ||
      !Array.isArray(payload.entries)
    ) {
      throw new Error(
        'Invalid payload'
      );
    }

    memoryPayload = payload;
    memorySavedAt = Date.now();

    setLiveCacheHeaders(res);

    res.setHeader(
      'X-Habit-Arena-Source',
      'sheet'
    );

    return res
      .status(200)
      .json(payload);

  } catch (error) {

    // If this Vercel instance already has an older successful
    // response, use it instead of showing an error.
    if (memoryPayload) {
      setLiveCacheHeaders(res);

      res.setHeader(
        'X-Habit-Arena-Source',
        'memory-stale'
      );

      return res
        .status(200)
        .json(memoryPayload);
    }

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    return res.status(502).json({
      error: 'Sheet temporarily unavailable'
    });
  }
}

// Habit Arena — reliable Google Sheet proxy
// No artificial timeout: Google Apps Script is allowed to finish properly.

let memoryPayload = null;
let memorySavedAt = 0;

function setCacheHeaders(res) {
  // Browser: very short cache
  res.setHeader(
    'Cache-Control',
    'public, max-age=5, s-maxage=30, stale-while-revalidate=86400'
  );

  // Vercel CDN: keep the last successful scoreboard available
  res.setHeader(
    'Vercel-CDN-Cache-Control',
    'public, s-maxage=30, stale-while-revalidate=86400'
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

  // If this Vercel instance already has recent data,
  // return it instantly.
  if (
    memoryPayload &&
    Date.now() - memorySavedAt < 30000
  ) {
    setCacheHeaders(res);

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
      throw new Error('Invalid Google Apps Script URL');
    }

    url.searchParams.set('token', token);

    // IMPORTANT:
    // No AbortController.
    // No 10-second timeout.
    // No 45-second timeout.
    // Let Apps Script actually finish.
    const response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(
        `Google Apps Script returned ${response.status}`
      );
    }

    const payload = await response.json();

    // If Apps Script itself reports a Sheet problem,
    // don't treat it as valid scoreboard data.
    if (payload?.error) {
      throw new Error(
        `Apps Script: ${payload.error}`
      );
    }

    if (
      payload?.schemaVersion !== '1.0' ||
      !payload.challenge ||
      !Array.isArray(payload.participants) ||
      !Array.isArray(payload.habits) ||
      !Array.isArray(payload.entries)
    ) {
      throw new Error(
        'Invalid scoreboard payload'
      );
    }

    memoryPayload = payload;
    memorySavedAt = Date.now();

    setCacheHeaders(res);

    res.setHeader(
      'X-Habit-Arena-Source',
      'sheet'
    );

    return res
      .status(200)
      .json(payload);

  } catch (error) {

    // If this function instance already has a successful
    // scoreboard snapshot, show that instead of failing.
    if (memoryPayload) {
      setCacheHeaders(res);

      res.setHeader(
        'X-Habit-Arena-Source',
        'memory-stale'
      );

      return res
        .status(200)
        .json(memoryPayload);
    }

    console.error(
      'Habit Arena Sheet error:',
      error
    );

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    return res.status(502).json({
      error: 'Sheet temporarily unavailable',
      reason: error?.message || 'Unknown error'
    });
  }
}

/**
 * TMDb API client helper.
 * Sends a GET request to the TMDb API and returns the parsed JSON.
 */

/**
 * Call a TMDb endpoint.
 *
 * @param {string} path - Endpoint path starting with "/" (e.g. "/discover/movie")
 * @param {Object} [params={}] - Query parameters. Values that are undefined, null or "" are skipped
 * @returns {Promise<Object>} Parsed TMDb JSON response
 * @throws {Error} The error has a `status` property for the HTTP response:
 *   500 - TMDB_API_KEY is missing, or TMDb rejected the key (401)
 *   404 - TMDb returned 404
 *   502 - TMDb could not be reached, or returned another error
 */ 

async function tmdbFetch(path, params = {}) {
  const token = process.env.TMDB_API_KEY;
  if (!token) {
    const err = new Error('TMDB_API_KEY is not set. Check your .env file.');
    err.status = 500;
    throw err;
  }

  const url = new URL(process.env.BASE_URL + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  let res;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', Authorization: `Bearer ${token}` },
    });
  } catch (cause) {
    const err = new Error('Could not reach TMDb. Please try again later.');
    err.status = 502;
    err.cause = cause;
    throw err;
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).status_message || '';
    } catch (_) {
      /* ignore */
    }
    const err = new Error(`TMDb request failed (${res.status})${detail ? `: ${detail}` : ''}`);
    // Handle TMDb authentication errors (401) as server configuration issues and return a 500 response.
    err.status = res.status === 401 ? 500 : res.status === 404 ? 404 : 502;
    throw err;
  }
  return res.json();
}

module.exports = { tmdbFetch };
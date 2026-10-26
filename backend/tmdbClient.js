'use strict';

const NodeCache = require('node-cache');
const BASE_URL = 'https://api.themoviedb.org/3';
const SORTS = new Set(['popularity', 'primary_release_date', 'revenue', 'title', 'original_title', 'vote_average', 'vote_count'].flatMap(s => [s + '.asc', s + '.desc']));

class TmdbError extends Error {
  constructor(message, { code = 'TMDB_ERROR', status = 502, upstreamStatus, retryAfter } = {}) {
    super(message);
    this.name = 'TmdbError';
    this.code = code;
    this.status = status;
    if (upstreamStatus !== undefined) this.upstreamStatus = upstreamStatus;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
function invalid(message) { throw new TmdbError(message, { code: 'INVALID_ARGUMENT', status: 400 }); }
function number(value, name, min, max, integer = false) {
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) invalid(`${name} must be a number`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) invalid(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  return n;
}
function optionsObject(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Options must be an object');
  if (Object.keys(value).some(k => !allowed.includes(k))) invalid('Unknown option');
}
function language(value = 'en-US') {
  if (typeof value !== 'string' || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(value)) invalid('language must be like en-US or ko-KR');
  return value;
}
function movieSummary(movie) {
  return {
    id: movie.id,
    title: movie.title ?? '',
    poster_path: movie.poster_path ?? null,
    release_date: movie.release_date || null,
    vote_average: movie.vote_average ?? null,
    genre_ids: movie.genre_ids ?? (movie.genres ?? []).map(g => g.id),
    overview: movie.overview ?? '',
    vote_count: movie.vote_count ?? 0,
  };
}
function paginated(data) {
  return { page: data.page, total_pages: data.total_pages, total_results: data.total_results, results: data.results.map(movieSummary) };
}
function badResponse() { throw new TmdbError('TMDb returned an invalid response', { code: 'INVALID_RESPONSE' }); }
function validMovie(m) {
  return m && Number.isInteger(m.id) && typeof m.title === 'string';
}
function validNamedItem(item) {
  return item && Number.isInteger(item.id) && typeof item.name === 'string';
}
function validateResponse(data, kind) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) badResponse();
  if (kind === 'list' && (!Array.isArray(data.results) || !data.results.every(m => validMovie(m) && Array.isArray(m.genre_ids)) || !Number.isInteger(data.page) || !Number.isInteger(data.total_pages) || !Number.isInteger(data.total_results))) badResponse();
  if (kind === 'genres' && (!Array.isArray(data.genres) || !data.genres.every(validNamedItem))) badResponse();
  if (kind === 'detail' && (
    !validMovie(data) || !Array.isArray(data.genres) || !data.genres.every(validNamedItem) ||
    !Array.isArray(data.credits?.cast) || !data.credits.cast.every(validNamedItem) ||
    !Array.isArray(data.videos?.results) || !data.videos.results.every(v =>
      v && typeof v.type === 'string' && typeof v.site === 'string' && typeof v.key === 'string')
  )) badResponse();
}

/** Create once per server process. Environment is read at creation, not import. */
function createTmdbClient({
  token = process.env.TMDB_READ_ACCESS_TOKEN || process.env.TMDB_TOKEN,
  apiKey = process.env.TMDB_API_KEY,
  ttlSeconds = process.env.TMDB_CACHE_TTL_SECONDS || 300,
  timeoutMs = process.env.TMDB_TIMEOUT_MS || 10000,
  maxCacheEntries = 1000,
  fetchImpl = globalThis.fetch,
} = {}) {
  ttlSeconds = number(ttlSeconds, 'ttlSeconds', 0.001, 86400);
  timeoutMs = number(timeoutMs, 'timeoutMs', 1, 120000, true);
  maxCacheEntries = number(maxCacheEntries, 'maxCacheEntries', 1, 100000, true);
  token = typeof token === 'string' ? token.trim() : '';
  apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!token && !apiKey) throw new TmdbError('Set TMDB_READ_ACCESS_TOKEN, TMDB_TOKEN or TMDB_API_KEY on the server', { code: 'MISSING_CREDENTIALS', status: 500 });
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const cache = new NodeCache({ stdTTL: ttlSeconds, checkperiod: 0, useClones: true });
  const pending = new Map();
  let generation = 0;
  const counters = { hits: 0, misses: 0, coalesced: 0, upstreamRequests: 0 };

  // keys() includes expired entries when periodic sweeping is disabled.
  // has() validates TTL and deletes expired entries without cloning payloads.
  function liveKeys() { return cache.keys().filter(key => cache.has(key)); }

  async function request(endpoint, params, kind) {
    const query = new URLSearchParams();
    for (const key of Object.keys(params).sort()) if (params[key] !== undefined) query.set(key, String(params[key]));
    // Key contains endpoint + normalized parameters; never credentials.
    const cacheKey = endpoint + '?' + query.toString();
    const cached = cache.get(cacheKey);
    if (cached !== undefined) { counters.hits++; return cached; }
    if (pending.has(cacheKey)) { counters.coalesced++; return structuredClone(await pending.get(cacheKey)); }
    counters.misses++;
    const requestGeneration = generation;
    const work = (async () => {
      const url = new URL(BASE_URL + endpoint);
      url.search = query.toString();
      const headers = { accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      else url.searchParams.set('api_key', apiKey);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        counters.upstreamRequests++;
        const response = await fetchImpl(url, { headers, signal: controller.signal });
        if (!response.ok) {
          const upstreamStatus = response.status;
          const status = upstreamStatus === 404 ? 404 : upstreamStatus === 429 ? 429 : 502;
          const rawRetry = response.headers.get('retry-after');
          const retryAfter = rawRetry && /^\d+$/.test(rawRetry) ? Number(rawRetry) : undefined;
          // Never expose upstream bodies, request URLs or headers in errors.
          throw new TmdbError(`TMDb returned HTTP ${upstreamStatus}`, { code: 'UPSTREAM_HTTP_ERROR', status, upstreamStatus, retryAfter });
        }
        let data;
        try { data = await response.json(); } catch { if (controller.signal.aborted) throw new Error('aborted'); badResponse(); }
        validateResponse(data, kind);
        // A request started before clearCache() may finish for its caller,
        // but must not repopulate the cleared cache with its old response.
        if (requestGeneration === generation) {
          const keys = liveKeys();
          if (keys.length >= maxCacheEntries) cache.del(keys[0]);
          cache.set(cacheKey, data);
        }
        return data;
      } catch (error) {
        if (error instanceof TmdbError) throw error;
        if (controller.signal.aborted) throw new TmdbError('TMDb request timed out', { code: 'UPSTREAM_TIMEOUT', status: 504 });
        throw new TmdbError('Could not connect to TMDb', { code: 'UPSTREAM_NETWORK_ERROR' });
      } finally { clearTimeout(timer); }
    })();
    pending.set(cacheKey, work);
    try { return structuredClone(await work); }
    finally { if (pending.get(cacheKey) === work) pending.delete(cacheKey); }
  }

  return {
    async searchMovies(query, options = {}) {
      optionsObject(options, ['page', 'language', 'year']);
      if (typeof query !== 'string' || !query.trim() || query.trim().length > 500) invalid('query must contain 1 to 500 characters');
      return paginated(await request('/search/movie', {
        query: query.trim(), page: number(options.page ?? 1, 'page', 1, 500, true),
        language: language(options.language), include_adult: false,
        primary_release_year: options.year === undefined ? undefined : number(options.year, 'year', 1, 9999, true),
      }, 'list'));
    },
    async discoverMovies(options = {}) {
      optionsObject(options, ['page', 'language', 'genreIds', 'genreMode', 'year', 'minRating', 'minVoteCount', 'sortBy']);
      const sortBy = options.sortBy ?? 'popularity.desc';
      if (!SORTS.has(sortBy)) invalid('Unsupported sortBy');
      const mode = options.genreMode ?? 'and';
      if (!['and', 'or'].includes(mode)) invalid('genreMode must be and or or');
      let genres;
      if (options.genreIds !== undefined) {
        if (!Array.isArray(options.genreIds)) invalid('genreIds must be an array');
        genres = [...new Set(options.genreIds.map(g => number(g, 'genre ID', 1, 2147483647, true)))].sort((a,b) => a-b).join(mode === 'and' ? ',' : '|') || undefined;
      }
      return paginated(await request('/discover/movie', {
        page: number(options.page ?? 1, 'page', 1, 500, true), language: language(options.language),
        include_adult: false, include_video: false, with_genres: genres, sort_by: sortBy,
        primary_release_year: options.year === undefined ? undefined : number(options.year, 'year', 1, 9999, true),
        'vote_average.gte': options.minRating === undefined ? undefined : number(options.minRating, 'minRating', 0, 10),
        'vote_count.gte': options.minVoteCount === undefined ? undefined : number(options.minVoteCount, 'minVoteCount', 0, 2147483647, true),
      }, 'list'));
    },
    async getGenres(options = {}) {
      optionsObject(options, ['language']);
      const data = await request('/genre/movie/list', { language: language(options.language) }, 'genres');
      return { genres: data.genres.map(({id, name}) => ({id, name})) };
    },
    async getMovieDetails(id, options = {}) {
      optionsObject(options, ['language']);
      id = number(id, 'movie ID', 1, 2147483647, true);
      const data = await request(`/movie/${id}`, { language: language(options.language), append_to_response: 'credits,videos' }, 'detail');
      const trailers = data.videos.results.filter(v => v.type === 'Trailer' && v.site === 'YouTube' && typeof v.key === 'string' && v.key)
        .map(v => ({ id: v.id, name: v.name, key: v.key, site: v.site, type: v.type, official: !!v.official, url: `https://www.youtube.com/watch?v=${encodeURIComponent(v.key)}` }))
        .sort((a,b) => Number(b.official) - Number(a.official));
      return {
        ...movieSummary(data), runtime: data.runtime ?? null, tagline: data.tagline ?? '',
        genres: data.genres.map(({id, name}) => ({id, name})),
        cast: data.credits.cast.map(({id, name, character, profile_path, order}) => ({id, name, character, profile_path: profile_path ?? null, order})),
        trailers, trailer: trailers[0] ?? null,
      };
    },
    getCacheStats() { return { ...counters, keys: liveKeys().length, ttlSeconds }; },
    clearCache() { generation++; cache.flushAll(); pending.clear(); },
  };
}

// Lazy singleton allows dotenv to be loaded by the application before first call.
let sharedClient;
function shared() { return sharedClient ??= createTmdbClient(); }
module.exports = {
  createTmdbClient, TmdbError,
  searchMovies: (...args) => shared().searchMovies(...args),
  discoverMovies: (...args) => shared().discoverMovies(...args),
  getGenres: (...args) => shared().getGenres(...args),
  getMovieDetails: (...args) => shared().getMovieDetails(...args),
  getCacheStats: () => shared().getCacheStats(),
  clearCache: () => shared().clearCache(),
};

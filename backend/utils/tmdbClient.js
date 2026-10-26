const path = require('path');
const fs = require('fs');
const NodeCache = require('node-cache');

// In-memory cache: 5 minutes TTL (300 seconds), check for expired keys every 60 seconds
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Check if Arthur's root tmdbClient.js is present
const arthurClientPath = path.resolve(__dirname, '../tmdbClient.js');
let arthurClient = null;
if (fs.existsSync(arthurClientPath)) {
  try {
    arthurClient = require(arthurClientPath);
  } catch (err) {
    // Falls back gracefully if credentials aren't set yet
  }
}

/**
 * TMDb Client module
 * Bridges with Arthur's tmdbClient if available, or provides native fetching + mock fallback.
 */
const tmdbClient = {
  /**
   * Search for movies, tv shows, or multi-search
   * @param {Object} options
   * @param {string} options.query - The search term
   * @param {'movie'|'tv'|'multi'} [options.type='multi'] - Type of search
   * @param {number} [options.page=1] - Page number
   * @returns {Promise<Object>} TMDb response object
   */
  async search({ query, type = 'multi', page = 1 }) {
    // If Arthur's client is merged and it's a movie search, delegate to Arthur's searchMovies
    if (arthurClient && typeof arthurClient.searchMovies === 'function' && type === 'movie') {
      try {
        const arthurResult = await arthurClient.searchMovies(query, { page });
        return { ...arthurResult, _cached: false, _source: 'arthur_client' };
      } catch (err) {
        // If Arthur's client throws (e.g. missing API token), fall through to internal handler
        console.warn('[tmdbClient] Arthur client fallback:', err.message);
      }
    }

    const cacheKey = `search:${type}:${query.toLowerCase().trim()}:${page}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return { ...cachedData, _cached: true };
    }

    const apiKey = process.env.TMDB_API_KEY || process.env.TMDB_TOKEN || process.env.TMDB_READ_ACCESS_TOKEN;

    // If real API key is present, call live TMDb API
    if (apiKey && apiKey !== 'your_key_here') {
      const endpoint = type === 'multi' ? 'multi' : type;
      const url = new URL(`${TMDB_BASE_URL}/search/${endpoint}`);
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('query', query.trim());
      url.searchParams.set('page', String(page));
      url.searchParams.set('include_adult', 'false');

      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const error = new Error(`TMDb API responded with status ${response.status}: ${errorBody}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      cache.set(cacheKey, data);
      return { ...data, _cached: false };
    }

    // High-fidelity fallback mock data when running locally without active API key
    const mockData = {
      page: Number(page),
      total_pages: 3,
      total_results: 24,
      results: [
        {
          id: 550,
          media_type: type === 'multi' ? 'movie' : type,
          title: `${query} - The Beginning`,
          overview: `A thrilling cinematic journey revolving around "${query}". Unfolds high-stakes drama and visual excellence.`,
          poster_path: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
          backdrop_path: '/fCayJrkfRaCRCTh8GqN30f8ioqq.jpg',
          release_date: '2023-07-21',
          vote_average: 8.6,
          vote_count: 3420,
          genre_ids: [28, 12, 878],
        },
        {
          id: 551,
          media_type: type === 'multi' ? 'tv' : type,
          name: `${query}: The Animated Series`,
          overview: `An episodic exploration of the ${query} universe with beloved characters and new adventures.`,
          poster_path: '/mXLOHHc1Zeuwsl4xYKjKh2280ne.jpg',
          backdrop_path: '/7drO1r5otKcAazoCDagHrG6j0L8.jpg',
          first_air_date: '2022-10-15',
          vote_average: 8.1,
          vote_count: 1280,
          genre_ids: [16, 35, 10759],
        },
        {
          id: 552,
          media_type: type === 'multi' ? 'movie' : type,
          title: `Legacy of ${query}`,
          overview: `Critically acclaimed follow-up featuring spectacular storytelling and award-winning cinematography.`,
          poster_path: '/8UlWqwvg5gvD2frQ2Q04LO20RBC.jpg',
          backdrop_path: '/9n2tJBplPbgR2ca05h6L1ekNDtJ.jpg',
          release_date: '2024-03-01',
          vote_average: 7.9,
          vote_count: 890,
          genre_ids: [18, 53],
        },
      ],
    };

    cache.set(cacheKey, mockData);
    return { ...mockData, _cached: false };
  },

  getCacheStats() {
    return cache.getStats();
  },

  flushCache() {
    return cache.flushAll();
  },
};

module.exports = tmdbClient;

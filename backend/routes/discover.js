const express = require('express');
const tmdb = require('../clients/tmdbClient');
const { HttpError } = require('../middleware/errorHandler');

// Titles need at least this many votes when `min_rating` is used.
// Prevents titles with very few votes from ranking at the top by rating.
const MIN_VOTE_COUNT = 50;

/**
 * Media types supported by /api/discover.
 */
const MEDIA_TYPES = {
  movie: {
    discover: (client, options) => client.discoverMovies(options),
    // Public `sort` value -> tmdbClient sort field (sortBy is "<field>.<order>")
    sortFields: {
      popularity: 'popularity',
      vote_average: 'vote_average',
      release_date: 'primary_release_date',
    },
  },
  // tv: {
  //   discover: (client, options) => client.discoverTv(options),
  //   sortFields: {
  //     popularity: 'popularity',
  //     vote_average: 'vote_average',
  //     release_date: 'first_air_date',
  //   },
  // },
};

/** Treat an empty query value (e.g. "?year=") as "not provided". */
const optional = (value) => (value === '' ? undefined : value);

/**
 * Convert the `genre` query value into tmdbClient options.
 * "28,12" -> all of these genres (AND), "28|12" -> any of these genres (OR).
 * @param {string|undefined} genre - Raw query value
 * @returns {{genreIds?: string[], genreMode?: 'and'|'or'}} Empty object when no genre was given
 * @throws {HttpError} 400 if the value is not a list of genre IDs, or mixes "," and "|"
 */
function parseGenre(genre) {
  if (genre === undefined) return {};
  if (typeof genre !== 'string' || !/^\d+([,|]\d+)*$/.test(genre)) {
    throw new HttpError(400, 'genre must be genre IDs joined by "," (AND) or "|" (OR), e.g. 28,12');
  }
  if (genre.includes(',') && genre.includes('|')) {
    throw new HttpError(400, 'genre cannot mix "," (AND) and "|" (OR)');
  }
  return { genreIds: genre.split(/[,|]/), genreMode: genre.includes('|') ? 'or' : 'and' };
}

/**
 * Create the /api/discover router.
 * @param {Object} [client=tmdb] - tmdbClient (or a compatible object). Tests pass their own client.
 * @returns {import('express').Router}
 */
function createDiscoverRouter(client = tmdb) {
  const router = express.Router();

  /**
   * GET /api/discover
   * Discover movies with optional filters. All filters can be combined in one request.
   *
   * @param {'movie'} [req.query.type='movie'] - Media type (movie only for now)
   * @param {string} [req.query.genre] - Genre IDs: "28,12" = all of them (AND), "28|12" = any of them (OR). IDs come from GET /api/genres
   * @param {number} [req.query.year] - Release year, e.g. 2023
   * @param {number} [req.query.min_rating] - Minimum average rating, 0-10. Titles with fewer than 50 votes are excluded
   * @param {'popularity'|'vote_average'|'release_date'} [req.query.sort='popularity'] - Sort field
   * @param {'asc'|'desc'} [req.query.order='desc'] - Sort order
   * @param {number} [req.query.page=1] - Page number, 1-500
   * @param {string} [req.query.language='en-US'] - Language of the results, e.g. en-US, ja-JP
   * @returns {{page: number, total_pages: number, total_results: number, results: Object[]}}
   *   200 - Movies normalized by tmdbClient. `poster_path` is a relative path (the frontend adds the image base URL)
   * @throws {HttpError} 400 - Invalid query parameter (year, min_rating, page and language are checked by tmdbClient)
   * @throws {Error} 429, 500, 502 or 504 - TMDb or server configuration problem (see the TMDb API Handoff Guide)
   *
   * @example
   * GET /api/discover?genre=28&year=2023&min_rating=7&sort=popularity
   */
  router.get('/', async (req, res, next) => {
    try {
      // 1. Media type
      const type = optional(req.query.type) ?? 'movie';
      if (typeof type !== 'string' || !Object.hasOwn(MEDIA_TYPES, type)) {
        throw new HttpError(400, `type must be one of: ${Object.keys(MEDIA_TYPES).join(', ')}`);
      }
      const media = MEDIA_TYPES[type];

      // 2. Sort field and order
      const sort = optional(req.query.sort) ?? 'popularity';
      const order = optional(req.query.order) ?? 'desc';
      if (typeof sort !== 'string' || !Object.hasOwn(media.sortFields, sort)) {
        throw new HttpError(400, `sort must be one of: ${Object.keys(media.sortFields).join(', ')}`);
      }
      if (order !== 'asc' && order !== 'desc') {
        throw new HttpError(400, 'order must be "asc" or "desc"');
      }

      // 3. Genres
      const genre = parseGenre(optional(req.query.genre));

      // 4. Call tmdbClient. It validates year, min_rating, page and language, and caches the result
      const minRating = optional(req.query.min_rating);
      const data = await media.discover(client, {
        ...genre,
        year: optional(req.query.year),
        minRating,
        minVoteCount: minRating !== undefined ? MIN_VOTE_COUNT : undefined,
        sortBy: `${media.sortFields[sort]}.${order}`,
        page: optional(req.query.page),
        language: optional(req.query.language),
      });

      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// server.js uses the default router: app.use('/api/discover', require('./routes/discover'))
module.exports = createDiscoverRouter();
module.exports.createDiscoverRouter = createDiscoverRouter;

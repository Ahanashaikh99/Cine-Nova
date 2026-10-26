const express = require('express');
const tmdb = require('../tmdbClient');

const TMDB_IMAGE_BASE_W500 = 'https://image.tmdb.org/t/p/w500';

/**
 * Creates the search router.
 * Accepts an optional client parameter for dependency injection in automated tests.
 */
function createSearchRouter(client = tmdb) {
  const router = express.Router();

  /**
   * GET /api/search
   * Search for movies by title with validation, pagination, and data formatting.
   *
   * Query params:
   *   - query (required): string, 1 to 500 characters
   *   - page (optional): integer, 1 to 500 (default 1)
   *   - year (optional): release year integer, 1874 to 2100
   *   - language (optional): e.g. 'en-US' (default 'en-US')
   */
  router.get('/', async (req, res, next) => {
    try {
      const { query, page = 1, year, language = 'en-US' } = req.query;

      // 1. Validate query
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "Query parameter 'query' is required and must contain 1 to 500 characters.",
        });
      }

      if (query.trim().length > 500) {
        return res.status(400).json({
          success: false,
          error: "Query parameter 'query' cannot exceed 500 characters.",
        });
      }

      // 2. Validate page
      const pageNum = Number(page);
      if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > 500) {
        return res.status(400).json({
          success: false,
          error: "Query parameter 'page' must be an integer between 1 and 500.",
        });
      }

      // 3. Validate optional year
      let parsedYear = undefined;
      if (year !== undefined && year !== '') {
        parsedYear = Number(year);
        if (!Number.isInteger(parsedYear) || parsedYear < 1874 || parsedYear > 2100) {
          return res.status(400).json({
            success: false,
            error: "Query parameter 'year' must be an integer between 1874 and 2100.",
          });
        }
      }

      // 4. Call Arthur's TMDb client (handles caching + upstream API)
      const data = await client.searchMovies(query.trim(), {
        page: pageNum,
        year: parsedYear,
        language,
      });

      // 5. Clean up & normalize response data (add CDN poster URLs)
      const results = (data.results || []).map((movie) => ({
        id: movie.id,
        title: movie.title || '',
        overview: movie.overview || '',
        poster_path: movie.poster_path || null,
        poster_url: movie.poster_path ? `${TMDB_IMAGE_BASE_W500}${movie.poster_path}` : null,
        release_date: movie.release_date || null,
        vote_average: movie.vote_average ?? null,
        vote_count: movie.vote_count ?? 0,
        genre_ids: movie.genre_ids || [],
      }));

      return res.status(200).json({
        success: true,
        page: data.page,
        total_pages: data.total_pages,
        total_results: data.total_results,
        results,
      });
    } catch (error) {
      const isTmdbError = error instanceof tmdb.TmdbError || error.name === 'TmdbError';
      if (isTmdbError) {
        if (error.retryAfter !== undefined) {
          res.set('Retry-After', String(error.retryAfter));
        }
        return res.status(error.status || 500).json({
          success: false,
          error: {
            code: error.code || 'TMDB_ERROR',
            message: error.message,
          },
        });
      }
      next(error);
    }
  });

  return router;
}

const defaultRouter = createSearchRouter();
defaultRouter.createSearchRouter = createSearchRouter;
module.exports = defaultRouter;

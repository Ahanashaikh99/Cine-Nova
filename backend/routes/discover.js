const express = require('express');
const { tmdbFetch } = require('../clients/tmdbClient');
const { HttpError } = require('../middleware/errorHandler');

const router = express.Router();

const SORT_FIELDS = ['popularity', 'vote_average', 'release_date'];


/**
 * Parse an optional integer query value and check its range.
 */
function parseIntInRange(value, name, min, max) {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

/**
 * Parse the optional minimum rating (min_rating).
 */
function parseRating(value) {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (Number.isNaN(n) || n < 0 || n > 10) {
    throw new HttpError(400, 'min_rating must be a number between 0 and 10');
  }
  return n;
}

/**
 * Parse an optional date query value.
 */
function parseDate(value, name) {
  if (value === undefined || value === '') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${name} must be in YYYY-MM-DD format`);
  }
  return value;
}

/**
 * GET /api/discover
 * Discover movies or TV shows with filters. All filters can be combined in one request.
 *
 * @query {'movie'|'tv'} [type='movie'] - Media type
 * @query {string} [genre] - Genre IDs: "28,12" (AND) or "28|12" (OR). IDs come from GET /api/genres
 * @query {number} [year] - Release year (e.g. 2023)
 * @query {string} [date_from] - Release date from (YYYY-MM-DD)
 * @query {string} [date_to] - Release date to (YYYY-MM-DD)
 * @query {number} [min_rating] - Minimum average rating, 0-10. Titles with fewer than 50 votes are excluded
 * @query {'popularity'|'vote_average'|'release_date'} [sort='popularity'] - Sort field
 * @query {'asc'|'desc'} [order='desc'] - Sort order
 * @query {number} [page=1] - Page number, 1-500
 * @query {string} [language='en-US'] - Language of the results (e.g. en-US, ja-JP)
 *
 * @returns {{type: string, page: number, totalPages: number, totalResults: number, results: Object[]}}
 *   200 - The TMDb results. `poster_path` is a relative path (the image base URL is added by the frontend)
 * @throws {HttpError} 400 - Invalid query parameter
 * @throws {HttpError} 500 - TMDB_API_KEY is missing or rejected by TMDb
 * @throws {HttpError} 502 - TMDb could not be reached
 *
 * @example
 * GET /api/discover?genre=28&year=2023&min_rating=7&sort=popularity
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      type = 'movie',
      genre,
      sort = 'popularity',
      order = 'desc',
      language = 'en-US',
    } = req.query;

    if (!['movie', 'tv'].includes(type)) {
      throw new HttpError(400, 'type must be "movie" or "tv"');
    }
    if (!SORT_FIELDS.includes(sort)) {
      throw new HttpError(400, `sort must be one of: ${SORT_FIELDS.join(', ')}`);
    }
    if (!['asc', 'desc'].includes(order)) {
      throw new HttpError(400, 'order must be "asc" or "desc"');
    }
    if (genre !== undefined && genre !== '' && !/^\d+([,|]\d+)*$/.test(genre)) {
      throw new HttpError(400, 'genre must be genre IDs joined by "," (AND) or "|" (OR), e.g. 28,12');
    }

    const year = parseIntInRange(req.query.year, 'year', 1874, 2100);
    const page = parseIntInRange(req.query.page, 'page', 1, 500) ?? 1;
    const minRating = parseRating(req.query.min_rating);
    const dateFrom = parseDate(req.query.date_from ?? req.query.dateFrom, 'date_from');
    const dateTo = parseDate(req.query.date_to ?? req.query.dateTo, 'date_to');
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new HttpError(400, 'date_from must be earlier than or equal to date_to');
    }

    const isMovie = type === 'movie';
    const dateField = isMovie ? 'primary_release_date' : 'first_air_date';
    const yearField = isMovie ? 'primary_release_year' : 'first_air_date_year';
    const sortField = sort === 'release_date' ? dateField : sort;

    const data = await tmdbFetch(`/discover/${type}`, {
      page,
      language,
      include_adult: false,
      with_genres: genre,
      [yearField]: year,
      [`${dateField}.gte`]: dateFrom,
      [`${dateField}.lte`]: dateTo,
      'vote_average.gte': minRating,
      // Prevent titles with very few votes from ranking at the top by rating.
      'vote_count.gte': minRating !== undefined ? 50 : undefined,
      sort_by: `${sortField}.${order}`,
    });

    res.json({
      type,
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

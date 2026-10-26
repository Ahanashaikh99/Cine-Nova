const express = require('express');
const router = express.Router();
const tmdbClient = require('../utils/tmdbClient');

const TMDB_IMAGE_BASE_W500 = 'https://image.tmdb.org/t/p/w500';
const TMDB_IMAGE_BASE_W780 = 'https://image.tmdb.org/t/p/w780';

/**
 * Validation Middleware for Search Query
 */
function validateSearchParams(req, res, next) {
  const { query, type = 'multi', page = 1 } = req.query;

  // 1. Validate query
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: "Query parameter 'query' is required and must be a non-empty string.",
    });
  }

  // 2. Validate type
  const validTypes = ['movie', 'tv', 'multi'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({
      success: false,
      error: `Invalid 'type' parameter. Allowed values are: ${validTypes.join(', ')}.`,
    });
  }

  // 3. Validate page
  const parsedPage = Number(page);
  if (!Number.isInteger(parsedPage) || parsedPage < 1) {
    return res.status(400).json({
      success: false,
      error: "Query parameter 'page' must be a positive integer greater than or equal to 1.",
    });
  }

  // Attach sanitized values to request
  req.searchParams = {
    query: query.trim(),
    type,
    page: parsedPage,
  };

  next();
}

/**
 * GET /api/search
 * Search for movies and TV shows with caching, pagination, and normalized data
 */
router.get('/', validateSearchParams, async (req, res, next) => {
  try {
    const { query, type, page } = req.searchParams;

    const rawData = await tmdbClient.search({ query, type, page });

    // Clean up, normalize, and construct CDN image URLs
    const cleanedResults = (rawData.results || [])
      // Filter out people or unknown types if multi-search returns them
      .filter((item) => !item.media_type || item.media_type === 'movie' || item.media_type === 'tv')
      .map((item) => {
        const itemType = item.media_type || (type === 'multi' ? 'movie' : type);
        return {
          id: item.id,
          media_type: itemType,
          title: item.title || item.name || 'Untitled',
          overview: item.overview || '',
          poster_url: item.poster_path ? `${TMDB_IMAGE_BASE_W500}${item.poster_path}` : null,
          backdrop_url: item.backdrop_path ? `${TMDB_IMAGE_BASE_W780}${item.backdrop_path}` : null,
          release_date: item.release_date || item.first_air_date || null,
          vote_average: typeof item.vote_average === 'number' ? Math.round(item.vote_average * 10) / 10 : null,
          vote_count: item.vote_count || 0,
          genre_ids: item.genre_ids || [],
        };
      });

    return res.status(200).json({
      success: true,
      meta: {
        query,
        type,
        page: rawData.page || page,
        total_pages: rawData.total_pages || 1,
        total_results: rawData.total_results || cleanedResults.length,
        cached: Boolean(rawData._cached),
      },
      results: cleanedResults,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

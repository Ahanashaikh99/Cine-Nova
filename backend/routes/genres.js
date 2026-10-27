const express = require('express');
const tmdb = require('../clients/tmdbClient');
const { HttpError } = require('../middleware/errorHandler');

const GENRE_LISTS = {
  movie: (client, options) => client.getGenres(options),
  // tv: (client, options) => client.getTvGenres(options),
};

/** Treat an empty query value (e.g. "?language=") as "not provided". */
const optional = (value) => (value === '' ? undefined : value);

/**
 * Create the /api/genres router.
 * @param {Object} [client=tmdb] - tmdbClient (or a compatible object). Tests pass their own client.
 * @returns {import('express').Router}
 */
function createGenresRouter(client = tmdb) {
  const router = express.Router();

  /**
   * GET /api/genres
   * Genre list used to build the filter UI. Use the returned IDs in GET /api/discover?genre=...
   *
   * @param {'movie'} [req.query.type='movie'] - Media type (movie only for now)
   * @param {string} [req.query.language='en-US'] - Language of the genre names, e.g. en-US, ja-JP
   * @returns {{genres: {id: number, name: string}[]}} 200 - Genre IDs and names
   * @throws {HttpError} 400 - Invalid query parameter
   *
   * @example
   * GET /api/genres?type=movie
   */
  router.get('/', async (req, res, next) => {
    try {
      const type = optional(req.query.type) ?? 'movie';
      if (typeof type !== 'string' || !Object.hasOwn(GENRE_LISTS, type)) {
        throw new HttpError(400, `type must be one of: ${Object.keys(GENRE_LISTS).join(', ')}`);
      }
      res.json(await GENRE_LISTS[type](client, { language: optional(req.query.language) }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// server.js uses the default router: app.use('/api/genres', require('./routes/genres'))
module.exports = createGenresRouter();
module.exports.createGenresRouter = createGenresRouter;

const express = require('express');
const { tmdbFetch } = require('../clients/tmdbClient');
const { HttpError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/genres?type=movie|tv&language=en-US
router.get('/', async (req, res, next) => {
  try {
    const { type = 'movie', language = 'en-US' } = req.query;
    if (!['movie', 'tv'].includes(type)) {
      throw new HttpError(400, 'type must be "movie" or "tv"');
    }
    const data = await tmdbFetch(`/genre/${type}/list`, { language });
    res.json({ type, genres: data.genres });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

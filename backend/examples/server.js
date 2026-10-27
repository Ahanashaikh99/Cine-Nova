'use strict';
require('dotenv').config({ quiet: true });
const express = require('express');
const tmdb = require('../tmdbClient');

// Integration example for Vritika and Suzuki, with an injectable client for tests.
function createApp(client = tmdb) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/search', async (req, res) => {
    const { query, page, language, year } = req.query;
    res.json(await client.searchMovies(query, { page, language, year }));
  });
  app.get('/api/discover', async (req, res) => {
    const { genres, genreMode, year, minRating, minVoteCount, sortBy, page, language } = req.query;
    if (genres !== undefined && typeof genres !== 'string') throw new tmdb.TmdbError('genres must be a comma-separated string', { code: 'INVALID_ARGUMENT', status: 400 });
    const genreIds = genres === undefined ? undefined : genres.split(',');
    res.json(await client.discoverMovies({ genreIds, genreMode, year, minRating, minVoteCount, sortBy, page, language }));
  });
  app.get('/api/genres', async (req, res) => res.json(await client.getGenres({ language: req.query.language })));
  app.get('/api/movies/:id', async (req, res) => res.json(await client.getMovieDetails(req.params.id, { language: req.query.language })));
  app.use((error, _req, res, _next) => {
    const known = error instanceof tmdb.TmdbError;
    if (known && error.retryAfter !== undefined) res.set('Retry-After', String(error.retryAfter));
    res.status(known ? error.status : 500).json({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Internal server error' } });
  });
  return app;
}
if (require.main === module) {
  // Fail early with a safe message when credentials are missing.
  try {
    const client = tmdb.createTmdbClient();
    const port = process.env.PORT || 3000;
    createApp(client).listen(port, '127.0.0.1', () => console.log(`Movie Magic listening at http://127.0.0.1:${port}`));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { createApp };

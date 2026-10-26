'use strict';
// Writes only selected public response fields and counters. Never dumps requests or credentials.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createTmdbClient } = require('../tmdbClient');
const { createApp } = require('../examples/server');

async function main() {
  const report = { executedAt: new Date().toISOString(), runtime: process.version, mode: 'LIVE TMDb HTTP requests', checks: [] };
  let client;
  try { client = createTmdbClient(); }
  catch (error) { report.checks.push({ name: 'credentials', ok: false, code: error.code }); }
  const observed = [];
  if (client) {
    client = createTmdbClient({ fetchImpl: async (url, init) => {
      const start = Date.now();
      const result = await fetch(url, init);
      observed.push({ endpoint: url.pathname, status: result.status, durationMs: Date.now() - start });
      return result;
    }});
    async function check(name, fn) {
      try { const details = await fn(); report.checks.push({ name, ok: true, ...details }); }
      catch (error) { report.checks.push({name, ok:false, code:error.code || 'ASSERTION_FAILED', status:error.status}); }
    }
    let movieId = 11;
    await check('search/movie', async () => {
      const result = await client.searchMovies('Inception');
      assert.ok(result.results.length > 0);
      movieId = result.results[0].id;
      assert.ok(Array.isArray(result.results[0].genre_ids));
      return { page: result.page, totalResults: result.total_results, sample: result.results[0] };
    });
    await check('discover/movie', async () => {
      const result = await client.discoverMovies({genreIds:[878],year:2010,minRating:7,minVoteCount:100,sortBy:'vote_average.desc'});
      assert.ok(result.results.length > 0);
      assert.ok(result.results.every(m => m.genre_ids.includes(878) && m.vote_average >= 7 && m.release_date.startsWith('2010')));
      return { totalResults:result.total_results,sample:result.results[0] };
    });
    await check('genre/movie/list', async () => {
      const result = await client.getGenres();
      assert.ok(result.genres.some(g => g.id === 878));
      return { count:result.genres.length,sample:result.genres.slice(0,3) };
    });
    await check('movie/:id?append_to_response=credits,videos', async () => {
      const result = await client.getMovieDetails(movieId);
      assert.equal(result.id,movieId); assert.ok(result.cast.length > 0);
      return { id:result.id,title:result.title,genre_ids:result.genre_ids,castCount:result.cast.length,trailerCount:result.trailers.length,trailer:result.trailer };
    });
    await check('repeat search uses cache', async () => {
      const before = client.getCacheStats();
      await client.searchMovies('Inception');
      const after = client.getCacheStats();
      assert.equal(after.upstreamRequests,before.upstreamRequests);
      assert.equal(after.hits,before.hits+1);
      return { additionalUpstreamRequests:0 };
    });
    const server = createApp(client).listen(0,'127.0.0.1');
    await new Promise(r => server.once('listening',r));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      for (const route of ['/api/search?query=Inception','/api/discover?genres=878&year=2010&minRating=7&minVoteCount=100&sortBy=vote_average.desc','/api/genres',`/api/movies/${movieId}`]) {
        await check('Express ' + route, async () => { const res = await fetch(base+route); assert.equal(res.status,200); await res.json(); return {status:res.status}; });
      }
    } finally { await new Promise(r => server.close(r)); }
    report.cache = client.getCacheStats();
  }
  report.requests = observed;
  report.passed = report.checks.filter(c => c.ok).length;
  report.failed = report.checks.filter(c => !c.ok).length;
  await fs.mkdir(path.join(__dirname,'../docs'),{recursive:true});
  await fs.writeFile(path.join(__dirname,'../docs/live-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if (report.failed) process.exitCode=1;
}
main().catch(() => { console.error('Live verification could not finish. Check network and local file access.'); process.exitCode=1; });

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTmdbClient } = require('../tmdbClient');
const { createSearchRouter } = require('../routes/search');

// Sample movie data fixture
const sampleMovie = {
  id: 101,
  title: 'Inception',
  poster_path: '/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg',
  release_date: '2010-07-16',
  vote_average: 8.4,
  vote_count: 35000,
  genre_ids: [28, 878, 12],
  overview: 'A thief who steals corporate secrets through dream-sharing technology.',
};

function setupTestApp(customHandler) {
  let fetchCount = 0;
  const mockFetch = async (url, init) => {
    fetchCount++;
    if (customHandler) return customHandler(url, init);
    const body = {
      page: 1,
      total_pages: 5,
      total_results: 50,
      results: [sampleMovie],
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const client = createTmdbClient({
    token: 'test-token-12345',
    fetchImpl: mockFetch,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/search', createSearchRouter(client));

  return { app, getFetchCount: () => fetchCount };
}

test('Task 4 Search: Query validation rejects empty query with 400', async () => {
  const { app } = setupTestApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/search?query=`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /required/);
  } finally {
    server.close();
  }
});

test('Task 4 Search: Page validation rejects non-integers and out-of-range pages with 400', async () => {
  const { app } = setupTestApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res1 = await fetch(`http://127.0.0.1:${port}/api/search?query=Inception&page=0`);
    assert.equal(res1.status, 400);

    const res2 = await fetch(`http://127.0.0.1:${port}/api/search?query=Inception&page=abc`);
    assert.equal(res2.status, 400);
  } finally {
    server.close();
  }
});

test('Task 4 Search: Year validation rejects invalid years with 400', async () => {
  const { app } = setupTestApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/search?query=Inception&year=999`);
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test('Task 4 Search: Valid query integrates Arthur tmdbClient and formats CDN URLs', async () => {
  const { app } = setupTestApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/search?query=Inception&page=1`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.success, true);
    assert.equal(body.page, 1);
    assert.equal(body.total_pages, 5);
    assert.equal(body.total_results, 50);
    assert.equal(body.results.length, 1);

    const first = body.results[0];
    assert.equal(first.id, 101);
    assert.equal(first.title, 'Inception');
    assert.equal(
      first.poster_url,
      'https://image.tmdb.org/t/p/w500/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg'
    );
    assert.equal(first.release_date, '2010-07-16');
  } finally {
    server.close();
  }
});

test('Task 4 Search: Verifies caching layer through Arthur client', async () => {
  const { app, getFetchCount } = setupTestApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // 1st call
    const res1 = await fetch(`http://127.0.0.1:${port}/api/search?query=Avatar&page=1`);
    assert.equal(res1.status, 200);
    assert.equal(getFetchCount(), 1, 'First search must fetch from upstream');

    // 2nd call (identical) - should be served from Arthur's cache!
    const res2 = await fetch(`http://127.0.0.1:${port}/api/search?query=Avatar&page=1`);
    assert.equal(res2.status, 200);
    assert.equal(getFetchCount(), 1, 'Second search must be served from cache without upstream fetch');
  } finally {
    server.close();
  }
});

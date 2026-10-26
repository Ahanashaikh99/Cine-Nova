const assert = require('assert');
const express = require('express');
const searchRouter = require('../routes/search');

// Create test express app
const app = express();
app.use(express.json());
app.use('/api/search', searchRouter);

async function runTests() {
  console.log('--- Running Cine-Nova Task 4 Search Tests ---');

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api/search`;

  try {
    // Test 1: Missing / empty query should return 400
    {
      const res = await fetch(`${baseUrl}?query=`);
      assert.strictEqual(res.status, 400, 'Empty query should return status 400');
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.ok(body.error.includes('required'));
      console.log('✅ Test 1 Passed: Empty query validation rejected with 400');
    }

    // Test 2: Invalid type should return 400
    {
      const res = await fetch(`${baseUrl}?query=Avatar&type=invalid_type`);
      assert.strictEqual(res.status, 400, 'Invalid type should return status 400');
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.ok(body.error.includes('Invalid'));
      console.log('✅ Test 2 Passed: Invalid type rejected with 400');
    }

    // Test 3: Invalid page should return 400
    {
      const res = await fetch(`${baseUrl}?query=Avatar&page=0`);
      assert.strictEqual(res.status, 400, 'Page 0 should return status 400');
      const body = await res.json();
      assert.strictEqual(body.success, false);
      assert.ok(body.error.includes('positive integer'));
      console.log('✅ Test 3 Passed: Invalid page rejected with 400');
    }

    // Test 4: Valid search should return 200 and normalized fields
    {
      const res = await fetch(`${baseUrl}?query=Inception&type=movie&page=1`);
      assert.strictEqual(res.status, 200, 'Valid search should return status 200');
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.meta.query, 'Inception');
      assert.strictEqual(body.meta.type, 'movie');
      assert.strictEqual(body.meta.page, 1);
      assert.ok(Array.isArray(body.results));
      assert.ok(body.results.length > 0);

      const first = body.results[0];
      assert.ok(first.id, 'Result must have id');
      assert.ok(first.title, 'Result must have normalized title');
      assert.ok(first.poster_url === null || first.poster_url.startsWith('https://image.tmdb.org'), 'Poster URL must point to CDN');
      assert.ok(typeof first.vote_average === 'number' || first.vote_average === null);
      console.log('✅ Test 4 Passed: Valid search returned 200 with sanitized data');
    }

    // Test 5: Caching check
    {
      const resCached = await fetch(`${baseUrl}?query=Inception&type=movie&page=1`);
      const bodyCached = await resCached.json();
      assert.strictEqual(bodyCached.meta.cached, true, 'Second search should hit cache');
      console.log('✅ Test 5 Passed: Caching verified (second identical query returned cached=true)');
    }

    console.log('\n🎉 ALL 5 TESTS PASSED SUCCESSFULLY! Task 4 is working perfectly.');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTmdbClient, TmdbError } = require('../tmdbClient');
const { createApp } = require('../examples/server');
const movie = { id: 11, title: 'Star Wars', poster_path: '/poster.jpg', release_date: '1977-05-25', vote_average: 8.2, genre_ids: [12, 878], overview: 'A test fixture', vote_count: 100 };
const list = { page: 1, total_pages: 1, total_results: 1, results: [movie] };
const response = (body = list, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function fixture(fn = () => response(), options = {}) {
  const calls = [];
  const client = createTmdbClient({ token: 'test-secret', ...options, fetchImpl: async (url, init) => { calls.push({ url: new URL(url), init }); return fn(url, init); } });
  return { client, calls };
}

test('search encodes text, keeps pagination and sends server-side Bearer auth', async () => {
  const { client, calls } = fixture();
  const result = await client.searchMovies('  기생충 & friends?  ', { page: '2', language: 'ko-KR', year: '2019' });
  assert.equal(calls[0].url.pathname, '/3/search/movie');
  assert.equal(calls[0].url.searchParams.get('query'), '기생충 & friends?');
  assert.equal(calls[0].url.searchParams.get('page'), '2');
  assert.equal(calls[0].url.searchParams.get('primary_release_year'), '2019');
  assert.equal(calls[0].url.searchParams.get('include_adult'), 'false');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-secret');
  assert.equal(calls[0].url.searchParams.has('api_key'), false);
  assert.deepEqual(result.results[0], movie);
  assert.equal(result.total_results, 1);
});
test('discover maps filters; canonical genre order reuses cache', async () => {
  const { client, calls } = fixture();
  await client.discoverMovies({ genreIds: [878,12,12], genreMode: 'or', year: 2020, minRating: 7.5, minVoteCount: 100, sortBy: 'vote_average.desc' });
  await client.discoverMovies({ sortBy: 'vote_average.desc', minVoteCount: 100, minRating: 7.5, year: 2020, genreMode: 'or', genreIds: [12,878] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('with_genres'), '12|878');
  assert.equal(calls[0].url.searchParams.get('vote_average.gte'), '7.5');
  assert.equal(calls[0].url.searchParams.get('primary_release_year'), '2020');
});
test('cache isolates language, page and endpoint and returns independent values', async () => {
  const { client, calls } = fixture();
  const a = await client.searchMovies('star');
  a.results[0].title = 'mutated';
  assert.equal((await client.searchMovies('star')).results[0].title, 'Star Wars');
  await client.searchMovies('star', { language: 'ko-KR' });
  await client.searchMovies('star', { page: 2 });
  await client.discoverMovies();
  assert.equal(calls.length, 4);
  assert.equal(client.getCacheStats().hits, 1);
});
test('concurrent identical requests share one upstream call', async () => {
  const { client, calls } = fixture(async () => { await new Promise(r => setTimeout(r, 10)); return response(); });
  const [a,b] = await Promise.all([client.searchMovies('star'), client.searchMovies('star')]);
  a.results[0].title = 'changed';
  assert.equal(b.results[0].title, 'Star Wars');
  assert.equal(calls.length, 1);
  assert.equal(client.getCacheStats().coalesced, 1);
});
test('TTL expiration fetches again and capacity stays bounded', async () => {
  const { client, calls } = fixture(undefined, { ttlSeconds: 0.02, maxCacheEntries: 2 });
  await client.searchMovies('a');
  await new Promise(r => setTimeout(r, 40));
  await client.searchMovies('a');
  assert.equal(calls.length, 2);
  await client.searchMovies('b'); await client.searchMovies('c');
  assert.ok(client.getCacheStats().keys <= 2);
  client.clearCache();
  assert.equal(client.getCacheStats().keys, 0);
});
test('cache statistics discard expired entries without a repeat lookup', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const { client } = fixture(undefined, { ttlSeconds: 1 });
  await client.searchMovies('expired');
  assert.equal(client.getCacheStats().keys, 1);
  t.mock.timers.tick(1001);
  assert.equal(client.getCacheStats().keys, 0);
});
test('clearCache separates old in-flight work from new requests for the same key', async () => {
  const releases = [];
  const { client, calls } = fixture(() => new Promise(resolve => releases.push(resolve)));
  const oldRequest = client.searchMovies('same');
  client.clearCache();
  const newRequest = client.searchMovies('same');
  // Release all requests even if this assertion fails, so no request is left hanging.
  if (calls.length !== 2) {
    releases.forEach(resolve => resolve(response()));
    await Promise.all([oldRequest, newRequest]);
    assert.equal(calls.length, 2);
  }
  releases[0](response({ ...list, results: [{ ...movie, title: 'Old' }] }));
  assert.equal((await oldRequest).results[0].title, 'Old');
  assert.equal(client.getCacheStats().keys, 0);
  const joined = client.searchMovies('same');
  assert.equal(calls.length, 2, 'finishing old work must not remove the new pending request');
  releases[1](response({ ...list, results: [{ ...movie, title: 'New' }] }));
  assert.equal((await newRequest).results[0].title, 'New');
  assert.equal((await joined).results[0].title, 'New');
  assert.equal((await client.searchMovies('same')).results[0].title, 'New');
});
test('malformed nested detail data is rejected and never cached', async () => {
  const valid = { ...movie, genres: [], credits: { cast: [] }, videos: { results: [] } };
  for (const broken of [
    { ...valid, genres: [null] },
    { ...valid, credits: { cast: [null] } },
    { ...valid, videos: { results: [null] } },
  ]) {
    const { client, calls } = fixture(() => response(broken));
    for (let i = 0; i < 2; i++) {
      await assert.rejects(() => client.getMovieDetails(11), e => e.code === 'INVALID_RESPONSE' && e.status === 502);
    }
    assert.equal(calls.length, 2);
    assert.equal(client.getCacheStats().keys, 0);
  }
});
test('a failed shared request is released so the next attempt can succeed', async () => {
  let fail;
  let attempts = 0;
  const { client, calls } = fixture(() => ++attempts === 1
    ? new Promise((_resolve, reject) => { fail = reject; })
    : response());
  const a = client.searchMovies('retry');
  const b = client.searchMovies('retry');
  fail(new Error('upstream failed'));
  const results = await Promise.allSettled([a, b]);
  assert.ok(results.every(r => r.status === 'rejected' && r.reason.code === 'UPSTREAM_NETWORK_ERROR'));
  assert.equal(calls.length, 1);
  assert.equal(client.getCacheStats().keys, 0);
  await client.searchMovies('retry');
  assert.equal(calls.length, 2);
});
test('invalid inputs fail without upstream calls', async () => {
  const { client, calls } = fixture();
  for (const action of [
    () => client.searchMovies(' '), () => client.searchMovies(['x']),
    () => client.searchMovies('x', { page: 501 }), () => client.searchMovies('x', { page: true }),
    () => client.searchMovies('x', { language: '../../' }), () => client.searchMovies('x', { token: 'override' }),
    () => client.discoverMovies({ minRating: 11 }), () => client.discoverMovies({ minRating: '' }),
    () => client.discoverMovies({ genreIds: ['bad'] }), () => client.discoverMovies({ genreMode: 'bad' }),
    () => client.discoverMovies({ sortBy: 'bad' }), () => client.getMovieDetails('../11'),
    () => client.getMovieDetails(0), () => client.getGenres(null),
  ]) await assert.rejects(action, e => e instanceof TmdbError && e.status === 400);
  assert.equal(calls.length, 0);
});
test('detail makes one appended call and selects official YouTube trailers', async () => {
  const data = { ...movie, genres: [{id:12,name:'Adventure'}], credits: {cast:[{id:1,name:'Actor',character:'Hero'}]}, videos: {results:[
    {id:'a',type:'Trailer',site:'YouTube',key:'unofficial',official:false},
    {id:'b',type:'Teaser',site:'YouTube',key:'teaser'},
    {id:'c',type:'Trailer',site:'Vimeo',key:'other'},
    {id:'d',type:'Trailer',site:'YouTube',key:'official',official:true},
  ]}};
  delete data.genre_ids;
  const { client, calls } = fixture(() => response(data));
  const result = await client.getMovieDetails('11');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('append_to_response'), 'credits,videos');
  assert.deepEqual(result.genre_ids, [12]);
  assert.equal(result.trailer.key, 'official');
  assert.equal(result.trailers.length, 2);
  assert.equal(result.cast[0].profile_path, null);
});
test('missing poster, release date and trailers remain explicit null/empty', async () => {
  const { client } = fixture(() => response({id:1,title:'Unknown',genres:[],credits:{cast:[]},videos:{results:[]}}));
  const result = await client.getMovieDetails(1);
  assert.equal(result.poster_path, null); assert.equal(result.release_date, null);
  assert.equal(result.trailer, null); assert.deepEqual(result.trailers, []);
});
test('genres keep only id/name and support language', async () => {
  const { client, calls } = fixture(() => response({genres:[{id:1,name:'Drama',extra:true}]}));
  assert.deepEqual(await client.getGenres({language:'ko-KR'}), {genres:[{id:1,name:'Drama'}]});
  assert.equal(calls[0].url.searchParams.get('language'), 'ko-KR');
});
test('v3 API key auth works without a Bearer token', async () => {
  const { client, calls } = fixture(undefined, {token:'',apiKey:'test-key'});
  await client.searchMovies('x');
  assert.equal(calls[0].url.searchParams.get('api_key'), 'test-key');
  assert.equal(calls[0].init.headers.Authorization, undefined);
});
test('missing credentials and invalid cache settings fail early', () => {
  assert.throws(() => createTmdbClient({token:'',apiKey:''}), e => e.code === 'MISSING_CREDENTIALS');
  assert.throws(() => createTmdbClient({token:'test',ttlSeconds:0}), e => e.code === 'INVALID_ARGUMENT');
});
test('HTTP errors are safe, not cached, and retain rate-limit metadata', async () => {
  for (const [upstream, expected] of [[401,502],[403,502],[404,404],[429,429],[500,502]]) {
    let attempts = 0;
    const { client } = fixture(() => ++attempts === 1 ? response({status_message:'test-secret'}, upstream, {'retry-after':'3'}) : response());
    await assert.rejects(() => client.searchMovies('x'), e => e.status === expected && e.upstreamStatus === upstream && !e.message.includes('test-secret') && e.retryAfter === 3);
    await client.searchMovies('x'); assert.equal(attempts, 2);
  }
});
test('network, malformed JSON and invalid schema errors do not leak payloads', async () => {
  for (const [fn, code] of [
    [() => { throw new Error('test-secret'); }, 'UPSTREAM_NETWORK_ERROR'],
    [() => new Response('test-secret'), 'INVALID_RESPONSE'],
    [() => response({results:[]}), 'INVALID_RESPONSE'],
  ]) {
    const {client,calls} = fixture(fn);
    for (let i=0;i<2;i++) await assert.rejects(() => client.searchMovies('x'), e => e.code === code && !e.message.includes('test-secret'));
    assert.equal(calls.length, 2);
  }
});
test('timeout aborts upstream fetch and maps to 504', async () => {
  const { client } = fixture((_url, {signal}) => new Promise((_resolve,reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), {once:true})), {timeoutMs:10});
  await assert.rejects(() => client.searchMovies('x'), e => e.code === 'UPSTREAM_TIMEOUT' && e.status === 504);
});
test('Express routes run over HTTP and validate malformed query parameters', async t => {
  const {client} = fixture(url => {
    if (url.pathname.endsWith('/genre/movie/list')) return response({genres:[{id:12,name:'Adventure'}]});
    if (url.pathname.endsWith('/movie/11')) return response({...movie,genres:[],credits:{cast:[]},videos:{results:[]}});
    return response();
  });
  const server = createApp(client).listen(0,'127.0.0.1');
  await new Promise(r => server.once('listening',r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/api/health','/api/search?query=star','/api/discover?genres=12,878&minRating=7','/api/genres','/api/movies/11']) {
    const result = await fetch(base + route); assert.equal(result.status,200,route); await result.json();
  }
  for (const route of ['/api/search?query=','/api/search?query=x&page=1&page=2','/api/discover?genres=bad','/api/discover?genres=12&genres=878','/api/movies/0']) {
    const result = await fetch(base + route); assert.equal(result.status,400,route); assert.equal((await result.json()).error.code,'INVALID_ARGUMENT');
  }
});

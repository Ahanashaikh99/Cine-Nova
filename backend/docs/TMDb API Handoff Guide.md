## Scope and request flow

Vritika's `/api/search` and Suzuki's `/api/discover` routes call `tmdbClient.js`. The module validates input, checks its in-process cache, and requests TMDb data on a cache miss. Teammates do not need to manage API credentials or raw TMDb error responses in their routes. Load dotenv when the server starts, then use the module's shared functions. **Creating a new client for each request prevents cache sharing**, so create it only once per server process.

## APIs used

Base URL: `https://api.themoviedb.org/3`. All requests use GET, and the default language is `en-US`.

| Purpose | Endpoint | Main parameters | Shared function |
| --- | --- | --- | --- |
| Title search | `/search/movie` | `query`, `page`, `language`, `primary_release_year` | `searchMovies(query, options)` |
| Filtered discovery | `/discover/movie` | `with_genres`, `primary_release_year`, `vote_average.gte`, `vote_count.gte`, `sort_by` | `discoverMovies(options)` |
| Genre list | `/genre/movie/list` | `language` | `getGenres(options)` |
| Details, cast, and videos | `/movie/{id}` | `append_to_response=credits,videos`, `language` | `getMovieDetails(id, options)` |

Title searches use [Search Movie](https://developer.themoviedb.org/reference/search-movie); filtered searches use [Discover Movie](https://developer.themoviedb.org/reference/discover-movie). In `with_genres`, commas mean AND and pipes mean OR. Genre names come from [Genre Movie List](https://developer.themoviedb.org/reference/genre-movie-list).

Appending `credits,videos` to a detail request retrieves all three types of data in a single HTTP request. See [Append To Response](https://developer.themoviedb.org/docs/append-to-response) and [Movie Details](https://developer.themoviedb.org/reference/movie-details) for details.

## Authentication setup

The project's existing `.env` credentials were verified against the live API. No new account or credentials were created. Teammates who need their own credentials can create a [TMDb account](https://www.themoviedb.org/signup) and apply through their [account API settings](https://www.themoviedb.org/settings/api). Follow the [getting started guide](https://developer.themoviedb.org/docs/getting-started), provide the required personal information, and accept the terms.

Credential precedence is `TMDB_READ_ACCESS_TOKEN` → `TMDB_TOKEN` → `TMDB_API_KEY`. The first two contain an **API Read Access Token**, sent in the `Authorization: Bearer ...` header. A v3 API Key is sent in the `api_key` query parameter. These formats are different; do not put a v3 key in the Bearer token field. If both are configured and token authentication fails, the client does not automatically retry with the API Key. See the [official authentication documentation](https://developer.themoviedb.org/docs/authentication-application).

The module does not load `.env` itself. Call `require('dotenv').config({ quiet: true })` in the application first, or provide deployment environment variables. Missing credentials produce `MISSING_CREDENTIALS`. `.env` and `.env.*` are excluded from Git; share only the empty `.env.example` template. Cache keys, error messages, and verification reports do not include credentials or authenticated request URLs.

## Function contracts

The module uses CommonJS, and all data functions return Promises. Numeric options also accept numeric strings from Express query parameters. Empty strings, arrays used as numbers, unknown options, and out-of-range values are rejected.

| Function | Options and defaults | Return value |
| --- | --- | --- |
| `searchMovies(query, options={})` | Trimmed query of 1–500 characters; `page=1` (1–500), `language='en-US'`, optional `year` | `{page, total_pages, total_results, results}` |
| `discoverMovies(options={})` | No genre filter by default, equivalent to `genreIds=[]`; `genreMode='and'` or `'or'`; `year`, `minRating` (0–10), `minVoteCount` (0 or greater), `sortBy='popularity.desc'`, `page=1`, `language='en-US'` | Same paginated response |
| `getGenres(options={})` | `language='en-US'` | `{genres:[{id,name}]}` |
| `getMovieDetails(id, options={})` | Positive integer id, `language='en-US'` | Summary fields plus `runtime`, `tagline`, `genres`, `cast`, `trailers`, `trailer` |
| `getCacheStats()` | None | hits, misses, coalesced, upstreamRequests, keys, ttlSeconds |
| `clearCache()` | None | Clears stored entries and detaches pending work; existing callers finish, but old responses cannot refill the cache |

Both search methods send `year` as `primary_release_year`. Genre IDs are deduplicated and sorted to allow cache reuse. Supported sort fields are `popularity`, `primary_release_date`, `revenue`, `title`, `original_title`, `vote_average`, and `vote_count`, each with an `.asc` or `.desc` suffix. Adult content is always excluded through `include_adult=false`; there is no option to enable it.

For custom configuration or test injection, create a client once when the server starts:

```js
const { createTmdbClient } = require('./tmdbClient');
const client = createTmdbClient({ ttlSeconds: 300, timeoutMs: 10000, maxCacheEntries: 1000 });
```

Language values such as `en`, `en-US`, and `ko-KR` are accepted. If no trailers are available in the requested language, the result contains `trailers=[]` and `trailer=null`. The client does not automatically retry in English, preserving the single-request detail contract.

## Raw JSON fields and normalized output

The field locations below were checked against the API contract and the live responses. `results[i]` refers to one movie in a search or discovery response.

| Information | Raw search/discovery response | Raw detail response | Module output |
| --- | --- | --- | --- |
| Movie ID | `results[i].id` | `id` | `id` |
| Title | `results[i].title` | `title` | `title` |
| Poster path | `results[i].poster_path` | `poster_path` | `poster_path`, or null if missing |
| Release date | `results[i].release_date` | `release_date` | `release_date`, or null if empty |
| Average rating | `results[i].vote_average` | `vote_average` | `vote_average` (0–10; zero is preserved) |
| Genre IDs | `results[i].genre_ids` | `genres[i].id` | Normalized as `genre_ids` |
| Genre names | Match IDs against the genre list | `genres[i].name` | Detail `genres` or `getGenres()` |
| Overview and vote count | `overview`, `vote_count` within each movie | `overview`, `vote_count` | Same field names |
| Cast | Not included | `credits.cast[]` | `cast[]` with id/name/character/profile_path/order |
| Videos | Not included | `videos.results[]` | Matching `trailers[]` and the primary `trailer` |

Pagination fields `page`, `total_pages`, and `total_results` are preserved. The frontend must handle an empty `results=[]` normally. Unnecessary TMDb fields are removed, and no function exposes the complete raw response. Use the Postman collection to inspect raw JSON.

Trailer selection requires `type === 'Trailer'`, `site === 'YouTube'`, and a nonempty key. Entries with `official=true` come first, and the first entry becomes `trailer`. The key is used to build a `https://www.youtube.com/watch?v=...` URL. Teasers and videos from other sites are excluded from the trailer output.

A poster path is not a complete URL. This example returns only the path, which the UI can display as follows. TMDb provides the image base URL and supported sizes through `/configuration`; see the [image documentation](https://developer.themoviedb.org/docs/image-basics) for URL construction.

```js
const posterUrl = movie.poster_path
  ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
  : null;
```

## Caching and error handling

The default `node-cache` TTL is 300 seconds. Configure it with `TMDB_CACHE_TTL_SECONDS`, using a value greater than 0 and up to 86400 seconds. Cache keys contain the endpoint and sorted request parameters. Different queries, languages, pages, or filters produce separate entries; credentials are never included. Each client instance has an isolated cache.

Only successful responses that pass schema validation are cached, including nested genres, cast, and video items in detail responses. Concurrent identical requests share the same pending Promise. Returned values are cloned, so a route cannot mutate another request's cached data. The cache holds at most 1000 keys and evicts the oldest inserted key when full. TTL is checked on access. Expired entries are also removed before insertion and when reading cache statistics, so `keys` counts only live entries. There is no periodic background sweep. The cache is lost on process restart and is not shared between servers.

`clearCache()` advances an internal generation and detaches pending requests. Existing callers still receive their responses, but those older responses cannot repopulate the cache. Requests made after clearing start fresh; completion of old work cannot remove a newer pending request. Diagnostic request counters remain cumulative after clearing.

Network requests and JSON body reads have a default 10-second timeout (`TMDB_TIMEOUT_MS`, 1–120000 ms). The client does not automatically retry requests. On a 429 response, a numeric `Retry-After` value is passed to the caller.

| Condition | Code | Example Express status |
| --- | --- | --- |
| Invalid input | INVALID_ARGUMENT | 400 |
| Missing credentials | MISSING_CREDENTIALS | 500 |
| TMDb 404 | UPSTREAM_HTTP_ERROR | 404 |
| TMDb 429 | UPSTREAM_HTTP_ERROR | 429 |
| TMDb 401/403 or other HTTP errors | UPSTREAM_HTTP_ERROR | 502 |
| Timeout | UPSTREAM_TIMEOUT | 504 |
| Connection failure | UPSTREAM_NETWORK_ERROR | 502 |
| Malformed JSON or missing required response structure | INVALID_RESPONSE | 502 |

`TmdbError` contains `status`, `code`, and, when applicable, `upstreamStatus` and `retryAfter`. TMDb 401/403 responses become 502 so that a server credential problem is not mistaken for a frontend user's login error. Raw upstream error bodies and request headers are not exposed to the client.

## Using Postman

1. Import `postman/TMDb.postman_collection.json` and the environment JSON.
2. Enter your API Read Access Token locally in the environment's `tmdb_token` field. Do not share an environment file containing the token.
3. Run Search → Discover → Genres → Details → Details with cast and videos in the Collection Runner.
4. The first search result's movie ID is stored as `movie_id`, so subsequent detail requests use the same movie.
5. If you only have an API Key, set the collection Authorization type to API Key, Key=`api_key`, Value=your key, and Add to=Query Params. The supplied Newman runner makes this switch automatically based on the server environment variables.

The Postman desktop app was not operated manually. The supplied collection was executed and verified against the live service with Newman, the Postman CLI runner. Reports store request names, HTTP statuses, and assertion statistics, excluding URLs and headers that contain credentials.

## Presentation notes

“As the Task 1 API explorer, I investigated movie search, discovery filters, genre lists, and movie details. Teammates can use the shared tmdbClient functions. Credentials are managed through server environment variables, and a default five-minute cache reduces repeated requests. Detail requests use append_to_response to retrieve cast and videos in one call. I normalized the different genre formats in search and detail responses into genre_ids and selected YouTube trailers for the output. All 15 automated tests, 9 live API/Express checks, and 14 Postman collection assertions passed.”

The team should include the TMDb logo and “This product uses the TMDB API but is not endorsed or certified by TMDB.” in the final UI's About/Credits section. See the [TMDb attribution guidance](https://developer.themoviedb.org/docs/faq).

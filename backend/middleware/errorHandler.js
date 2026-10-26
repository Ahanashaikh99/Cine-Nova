//For input errors: new HttpError(400, 'message')
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}


function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  // tmdbClient (TmdbError) sets `retryAfter` when TMDb answers 429 (too many requests)
  if (err.retryAfter !== undefined) res.set('Retry-After', String(err.retryAfter));
  res.status(status).json({ error: err.message || 'Internal Server Error' });
}

module.exports = { HttpError, notFound, errorHandler };

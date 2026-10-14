class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (m, c) => new HttpError(400, m, c);
const unauthorized = (m = 'Unauthorized') => new HttpError(401, m, 'unauthorized');
const forbidden = (m = 'Forbidden', c = 'forbidden') => new HttpError(403, m, c);
const notFound = (m = 'Not found', c = 'not_found') => new HttpError(404, m, c);
const conflict = (m, c) => new HttpError(409, m, c || 'conflict');

module.exports = { HttpError, bad, unauthorized, forbidden, notFound, conflict };

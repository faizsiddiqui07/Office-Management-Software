import { ZodError } from 'zod';
import { fail } from '../lib/apiResponse.js';

/** Throwable application error carrying an HTTP status + machine code. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFoundHandler(_req, res) {
  res.status(404).json(fail('NOT_FOUND', 'Resource not found'));
}

// Express error handler — must keep all 4 args.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    res.status(422).json(fail('VALIDATION_ERROR', 'Invalid request', err.flatten()));
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json(fail(err.code, err.message, err.details));
    return;
  }

  console.error('Unhandled error:', err);
  const message = err instanceof Error ? err.message : 'Internal server error';
  res
    .status(500)
    .json(fail('INTERNAL', process.env.NODE_ENV === 'production' ? 'Internal server error' : message));
}

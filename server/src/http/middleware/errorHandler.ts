import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, isAppError } from '../../errors.js';
import type { Logger } from 'pino';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown;
    requestId: string;
  };
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`No route matches ${req.method} ${req.path}`));
};

/**
 * One place turns every failure into the same envelope. Known failures keep
 * their typed code; unexpected ones are logged with the stack and reported as
 * INTERNAL so nothing leaks to the client.
 */
export const createErrorHandler = (logger: Logger): ErrorRequestHandler => {
  const handler: ErrorRequestHandler = (error, req, res, _next) => {
    const requestIdValue = String(req.id ?? 'unknown');
    let status = 500;
    let code = 'INTERNAL';
    let message = 'Unexpected server error';
    let details: unknown = null;

    if (isAppError(error)) {
      status = error.status;
      code = error.code;
      message = error.message;
      details = error.details;
    } else if (error instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request payload failed validation';
      details = error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    } else if (isMongoDuplicateKeyError(error)) {
      status = 409;
      code = 'CONFLICT';
      message = 'That resource already exists';
      details = { keys: Object.keys((error as { keyPattern?: Record<string, unknown> }).keyPattern ?? {}) };
    } else if (isMongoCastError(error)) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Malformed identifier';
      details = null;
    } else if (isBodyParserError(error)) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request body could not be parsed as JSON';
      details = null;
    }

    const logPayload = { requestId: requestIdValue, code, status, err: error instanceof Error ? error.message : String(error) };
    if (status >= 500) logger.error(logPayload, 'request failed');
    else logger.warn(logPayload, 'request rejected');

    if (res.headersSent) {
      res.end();
      return;
    }
    const body: ErrorBody = { error: { code, message, details, requestId: requestIdValue } };
    // Some failures happen after a handler already set a content type (e.g. a
    // 416 while streaming audio): the envelope must still be JSON.
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(status).json(body);
  };
  return handler;
};

const isMongoDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

const isMongoCastError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { name?: string }).name === 'CastError';

const isBodyParserError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as { type?: string }).type === 'string' &&
  (error as { type: string }).type.startsWith('entity.parse.failed');

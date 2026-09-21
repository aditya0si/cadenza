/**
 * Typed error codes. Every failure the API can produce maps to one of these,
 * and the error handler turns them into a stable JSON envelope:
 *
 *   { error: { code, message, details?, requestId } }
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INVALID_SIGNATURE',
  'EXPIRED_SIGNATURE',
  'INVALID_RANGE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INVALID_SIGNATURE: 403,
  EXPIRED_SIGNATURE: 410,
  INVALID_RANGE: 416,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details ?? null;
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError('VALIDATION_ERROR', message, details);
  }
  static unauthenticated(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHENTICATED', message);
  }
  static forbidden(message = 'You do not have access to this resource'): AppError {
    return new AppError('FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found'): AppError {
    return new AppError('NOT_FOUND', message);
  }
  static conflict(message: string, details?: unknown): AppError {
    return new AppError('CONFLICT', message, details);
  }
  static unavailable(message = 'Service temporarily unavailable'): AppError {
    return new AppError('SERVICE_UNAVAILABLE', message);
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

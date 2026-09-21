/**
 * Per-file setup. Tests must never write application logs into the report, so
 * the level is forced to `silent` unless the caller asked for something else.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';

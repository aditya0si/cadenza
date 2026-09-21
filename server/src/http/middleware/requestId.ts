import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const HEADER = 'x-request-id';
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Every request gets a correlation id that also appears in the JSON logs. */
export const requestId = (): RequestHandler => (req, res, next) => {
  const incoming = req.header(HEADER);
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(HEADER, req.id);
  next();
};

export const REQUEST_ID_HEADER = HEADER;

import type { Request, RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';

export interface RequestSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * `req.query`/`req.params` are prototype getters in Express, so validated values
 * are installed as own properties instead of assigned.
 */
const setOwn = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: true });
};

export const validate =
  (schemas: RequestSchemas): RequestHandler =>
  (req, _res, next) => {
    try {
      if (schemas.params) setOwn(req, 'params', schemas.params.parse(req.params));
      if (schemas.query) setOwn(req, 'query', schemas.query.parse(req.query));
      if (schemas.body) setOwn(req, 'body', schemas.body.parse(req.body));
      next();
    } catch (error) {
      next(error);
    }
  };

/** Typed access to a query object already parsed by `validate`. */
export const query = <T>(req: Request): T => req.query as unknown as T;

/** Typed access to a body already parsed by `validate`. */
export const body = <T>(req: Request): T => req.body as unknown as T;

export type Infer<T extends ZodTypeAny> = z.infer<T>;

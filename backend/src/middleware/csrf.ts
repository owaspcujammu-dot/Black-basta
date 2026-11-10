import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { CSRF_COOKIE } from '../services/auth.service';
import { HttpError } from '../utils/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function originAllowed(req: Request): boolean {
  const origin = req.get('origin');
  if (!origin) return true; // Non-browser clients send no Origin; the token check still applies.
  if (config.frontendOrigins.includes(origin.replace(/\/+$/, ''))) return true;
  try {
    // Same-origin deployments (frontend and API behind one reverse proxy).
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

/**
 * CSRF defence for cookie-authenticated requests:
 *  1. SameSite=Strict session cookie (set in auth.service),
 *  2. Origin header must be an allowed origin,
 *  3. double-submit token: the X-CSRF-Token header must equal the kop_csrf cookie.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  if (!originAllowed(req)) {
    throw new HttpError(403, 'CSRF_ORIGIN', 'Request origin is not allowed.');
  }
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get('x-csrf-token');
  if (typeof cookieToken !== 'string' || !cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    throw new HttpError(403, 'CSRF_TOKEN', 'Missing or invalid CSRF token. Refresh the page and try again.');
  }
  next();
}

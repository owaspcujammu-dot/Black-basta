import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';
import { config } from '../config';

/*
 * CTF events are often played from one room behind a single NAT address, so
 * limits are keyed by ACCOUNT wherever the request is authenticated. Purely
 * IP-keyed limits are kept generous enough for ~110 people sharing one IP.
 */

const passthrough: RequestHandler = (_req, _res, next) => next();

const ipKey = (req: Request) => `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
const userOrIpKey = (req: Request) => (req.auth ? `user:${req.auth.id}` : ipKey(req));
/** Team logins: each player on a team has their own allowance. Needs requireAuth first (it sets req.player). */
const playerKey = (req: Request) => (req.player ? `${userOrIpKey(req)}|player:${req.player.toLowerCase()}` : userOrIpKey(req));

function limiter(message: string, options: Partial<Options>): RequestHandler {
  if (!config.rateLimitEnabled) return passthrough;
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
    },
    ...options,
  });
}

/** Baseline for every API route. */
export const apiLimiter = limiter('Too many requests. Slow down, pirate.', {
  windowMs: 60_000,
  limit: (req) => (req.auth ? 300 : 1500),
  keyGenerator: userOrIpKey,
});

/** Login: failed attempts per (IP + account). Successful logins do not count. */
export const loginLimiter = limiter('Too many failed login attempts. Try again in 15 minutes.', {
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase().slice(0, 254) : '';
    return `${ipKey(req)}|${identifier}`;
  },
});

/** Registration: per IP, sized for a whole room registering from one address. */
export const registerLimiter = limiter('Too many registration attempts from this network. Try again later.', {
  windowMs: 60 * 60_000,
  limit: 300,
  keyGenerator: ipKey,
});

/** Flag submissions per player (or per account outside team mode), across all challenges. */
export const submitLimiter = limiter(`You can enter at most ${config.submitLimitPerMinute} flags a minute. Wait a moment before trying again.`, {
  windowMs: 60_000,
  limit: config.submitLimitPerMinute,
  keyGenerator: playerKey,
});

/** Flag submissions per player per challenge: stops brute-forcing a single flag. */
export const submitPerChallengeLimiter = limiter('Too many attempts on this challenge. Wait a minute before trying again.', {
  windowMs: 60_000,
  limit: config.submitLimitPerChallenge,
  keyGenerator: (req) => `${playerKey(req)}|challenge:${req.params.id}`,
});

/** Admin uploads and other heavy writes. */
export const uploadLimiter = limiter('Too many uploads. Try again shortly.', {
  windowMs: 60_000,
  limit: 30,
  keyGenerator: userOrIpKey,
});

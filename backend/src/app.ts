import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config';
import { attachAuth } from './middleware/auth';
import { csrfProtection } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/error';
import { apiLimiter } from './middleware/rateLimit';
import { apiRouter } from './routes';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Needed for correct client IPs (rate limiting) behind nginx. See TRUST_PROXY.
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      // This server only returns JSON and file downloads: lock everything down.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(cors({ origin: config.frontendOrigins, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE'] }));
  // Never compress the SSE stream: compression buffers and would delay events.
  app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/stream') && compression.filter(req, res) }));
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());

  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', attachAuth, apiLimiter, csrfProtection, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

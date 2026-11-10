import { Router } from 'express';
import * as auth from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth';
import { loginLimiter, registerLimiter } from '../middleware/rateLimit';

export const authRouter = Router();

authRouter.get('/csrf', auth.csrf);
authRouter.post('/register', registerLimiter, auth.register);
authRouter.post('/login', loginLimiter, auth.login);
authRouter.post('/logout', auth.logout);
authRouter.get('/me', requireAuth, auth.me);

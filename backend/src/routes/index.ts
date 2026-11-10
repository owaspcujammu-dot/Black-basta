import { Router } from 'express';
import * as publicController from '../controllers/public.controller';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { adminRouter } from './admin.routes';
import { authRouter } from './auth.routes';
import { challengeRouter } from './challenge.routes';
import * as challengeController from '../controllers/challenge.controller';

export const apiRouter = Router();

// Public
apiRouter.get('/health', publicController.health);
apiRouter.get('/event', publicController.eventInfo);
apiRouter.get('/scoreboard', publicController.scoreboard);
apiRouter.get('/scoreboard/history', publicController.scoreHistory);
apiRouter.get('/stream', optionalAuth, publicController.stream);

apiRouter.use('/auth', authRouter);

// Participants (and admins)
apiRouter.get('/profile', requireAuth, publicController.profile);
apiRouter.get('/announcements', requireAuth, publicController.listAnnouncements);
apiRouter.get('/categories', requireAuth, challengeController.listCategories);
apiRouter.get('/practice', requireAuth, challengeController.listPractice);
apiRouter.use('/challenges', challengeRouter);

// Admins only
apiRouter.use('/admin', adminRouter);

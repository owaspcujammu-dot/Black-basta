import { Router } from 'express';
import * as challenges from '../controllers/challenge.controller';
import { requireAuth } from '../middleware/auth';
import { submitLimiter, submitPerChallengeLimiter } from '../middleware/rateLimit';

export const challengeRouter = Router();

challengeRouter.use(requireAuth);

challengeRouter.get('/', challenges.listChallenges);
challengeRouter.get('/:id', challenges.getChallenge);
challengeRouter.get('/:id/solves', challenges.listSolves);
challengeRouter.post('/:id/submit', submitLimiter, submitPerChallengeLimiter, challenges.submit);
challengeRouter.post('/:id/hints/:hintId/unlock', challenges.revealHint);
challengeRouter.get('/:id/attachments/:attachmentId', challenges.downloadAttachment);

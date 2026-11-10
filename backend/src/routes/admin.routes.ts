import { Router } from 'express';
import * as admin from '../controllers/admin.controller';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimit';
import { attachmentUpload } from '../services/upload.service';

export const adminRouter = Router();

// Every admin route: valid session AND admin role (checked against the database).
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/dashboard', admin.dashboard);

adminRouter.get('/challenges', admin.listChallenges);
adminRouter.post('/challenges', admin.createChallenge);
adminRouter.put('/challenges/:id', admin.updateChallenge);
adminRouter.delete('/challenges/:id', admin.deleteChallenge);
adminRouter.get('/challenges/:id/flags', admin.getChallengeFlags);
adminRouter.post('/challenges/:id/attachments', uploadLimiter, attachmentUpload.array('files', 5), admin.uploadAttachments);
adminRouter.delete('/attachments/:id', admin.deleteAttachment);

adminRouter.get('/users', admin.listUsers);
adminRouter.put('/users/:id', admin.updateUser);
adminRouter.delete('/users/:id', admin.deleteUser);
adminRouter.post('/teams', admin.createTeams);
adminRouter.get('/users/:id/submissions', admin.userSubmissions);
adminRouter.get('/users/:id/password', admin.getUserPassword);

adminRouter.get('/event', admin.getEventAdmin);
adminRouter.post('/event/state', admin.eventAction);
adminRouter.put('/event', admin.eventSchedule);

adminRouter.get('/export/:kind', admin.exportCsv);

adminRouter.post('/announcements', admin.createAnnouncement);
adminRouter.delete('/announcements/:id', admin.deleteAnnouncement);

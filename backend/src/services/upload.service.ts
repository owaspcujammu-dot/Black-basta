import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config';
import { idParam } from '../utils/errors';
import { safeStoredExtension } from '../utils/text';

/** uploads/challenge_001/ — derived from the numeric id only. */
export function challengeUploadDir(challengeId: number): string {
  return path.join(config.uploadDir, `challenge_${String(challengeId).padStart(3, '0')}`);
}

/**
 * Attachment uploads (admin only).
 *  - Stored outside any web root and never served statically.
 *  - On-disk names are random hex; the client's filename is never used as a path.
 *  - Size and count limits are enforced while streaming.
 */
export const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, callback) => {
      try {
        const directory = challengeUploadDir(idParam(req.params.id));
        fs.mkdirSync(directory, { recursive: true });
        callback(null, directory);
      } catch (error) {
        callback(error as Error, '');
      }
    },
    filename: (_req, file, callback) => {
      callback(null, `${crypto.randomBytes(8).toString('hex')}.${safeStoredExtension(file.originalname)}`);
    },
  }),
  limits: { fileSize: config.maxUploadBytes, files: 5, fields: 5 },
});

export function removeStoredFile(challengeId: number, storedName: string) {
  const directory = challengeUploadDir(challengeId);
  const filePath = path.resolve(directory, storedName);
  if (path.dirname(filePath) !== directory) return;
  fs.rmSync(filePath, { force: true });
}

export function removeChallengeFiles(challengeId: number) {
  fs.rmSync(challengeUploadDir(challengeId), { recursive: true, force: true });
}

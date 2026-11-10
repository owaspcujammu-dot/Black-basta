-- Admin-viewable sealed copies (AES-GCM, key outside the database) of flags and
-- organizer-set team passwords. Answers are still checked against the hashes.
ALTER TABLE "Challenge" ADD COLUMN "flagSecret" TEXT;
ALTER TABLE "ChallengeFlag" ADD COLUMN "secret" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordSecret" TEXT;

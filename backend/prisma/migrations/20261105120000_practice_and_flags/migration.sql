-- Practice challenges: open any time, never part of the competition's scores.
ALTER TABLE "Challenge" ADD COLUMN "practice" BOOLEAN NOT NULL DEFAULT false;
-- Flags compared without regard to capitals (stored hashes are of the lower-cased flag).
ALTER TABLE "Challenge" ADD COLUMN "flagCaseInsensitive" BOOLEAN NOT NULL DEFAULT false;

-- Further accepted flags for a challenge (hashed like the main flag).
CREATE TABLE "ChallengeFlag" (
    "id" SERIAL NOT NULL,
    "challengeId" INTEGER NOT NULL,
    "flagHash" TEXT NOT NULL,
    "flagSalt" TEXT NOT NULL,
    CONSTRAINT "ChallengeFlag_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChallengeFlag_challengeId_idx" ON "ChallengeFlag"("challengeId");
ALTER TABLE "ChallengeFlag" ADD CONSTRAINT "ChallengeFlag_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Practice solves: kept apart from Solve so they never reach scores, first blood or exports.
CREATE TABLE "PracticeSolve" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "challengeId" INTEGER NOT NULL,
    "playerName" TEXT,
    "solvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeSolve_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PracticeSolve_userId_challengeId_key" ON "PracticeSolve"("userId", "challengeId");
CREATE INDEX "PracticeSolve_challengeId_idx" ON "PracticeSolve"("challengeId");
ALTER TABLE "PracticeSolve" ADD CONSTRAINT "PracticeSolve_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeSolve" ADD CONSTRAINT "PracticeSolve_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dynamic scoring: a challenge's value drops as more crews solve it.
CREATE TYPE "ScoringType" AS ENUM ('STATIC', 'DYNAMIC');
ALTER TABLE "Challenge" ADD COLUMN "scoring" "ScoringType" NOT NULL DEFAULT 'STATIC';
ALTER TABLE "Challenge" ADD COLUMN "minimumPoints" INTEGER;
ALTER TABLE "Challenge" ADD COLUMN "decay" INTEGER;

-- Score changes caused by other crews solving a dynamic challenge.
ALTER TYPE "ScoreReason" ADD VALUE 'DECAY';

-- Scoreboard freeze: from freezeAt everyone sees the board as it was then, until the organizers reveal it.
ALTER TABLE "Event" ADD COLUMN "freezeAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN "frozenScoreboard" JSONB;

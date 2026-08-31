-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "conference" TEXT,
    "timezone" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSourceAlias" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'needs_review',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamSourceAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rivalry" (
    "id" TEXT NOT NULL,
    "teamAId" TEXT NOT NULL,
    "teamBId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Rivalry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamRatingWeekly" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "spPlusOverall" DOUBLE PRECISION,
    "spPlusOffense" DOUBLE PRECISION,
    "spPlusDefense" DOUBLE PRECISION,
    "avgPossessionsPerGame" DOUBLE PRECISION,
    "pulledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamRatingWeekly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "kickoffTime" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "venueLat" DOUBLE PRECISION,
    "venueLng" DOUBLE PRECISION,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Line" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "sportsbook" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "lineValue" DOUBLE PRECISION NOT NULL,
    "price" INTEGER,
    "snapshotType" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Weather" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "windMph" DOUBLE PRECISION,
    "precipProbability" DOUBLE PRECISION,
    "tempF" DOUBLE PRECISION,
    "pulledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Weather_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Injury" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "position" TEXT,
    "isImpactPlayer" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Injury_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelPrediction" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "predictedSpread" DOUBLE PRECISION,
    "predictedTotal" DOUBLE PRECISION,
    "homeExpectedPpp" DOUBLE PRECISION,
    "awayExpectedPpp" DOUBLE PRECISION,
    "predictedPossessions" DOUBLE PRECISION,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameFlag" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "flagType" TEXT NOT NULL,
    "detail" JSONB,

    CONSTRAINT "GameFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pick" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "modelLine" DOUBLE PRECISION NOT NULL,
    "marketLine" DOUBLE PRECISION NOT NULL,
    "edge" DOUBLE PRECISION NOT NULL,
    "flagsPresent" JSONB,
    "suggestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closingLine" DOUBLE PRECISION,
    "actualResult" DOUBLE PRECISION,
    "atsResult" TEXT,
    "gradedAt" TIMESTAMP(3),

    CONSTRAINT "Pick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_canonicalName_key" ON "Team"("canonicalName");

-- CreateIndex
CREATE INDEX "TeamSourceAlias_teamId_idx" ON "TeamSourceAlias"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSourceAlias_source_sourceName_key" ON "TeamSourceAlias"("source", "sourceName");

-- CreateIndex
CREATE INDEX "TeamRatingWeekly_season_week_idx" ON "TeamRatingWeekly"("season", "week");

-- CreateIndex
CREATE UNIQUE INDEX "TeamRatingWeekly_teamId_season_week_key" ON "TeamRatingWeekly"("teamId", "season", "week");

-- CreateIndex
CREATE INDEX "Game_season_week_idx" ON "Game"("season", "week");

-- CreateIndex
CREATE INDEX "Line_gameId_idx" ON "Line"("gameId");

-- CreateIndex
CREATE INDEX "Weather_gameId_idx" ON "Weather"("gameId");

-- CreateIndex
CREATE INDEX "Injury_gameId_idx" ON "Injury"("gameId");

-- CreateIndex
CREATE INDEX "ModelPrediction_gameId_idx" ON "ModelPrediction"("gameId");

-- CreateIndex
CREATE INDEX "GameFlag_gameId_idx" ON "GameFlag"("gameId");

-- CreateIndex
CREATE INDEX "Pick_gameId_idx" ON "Pick"("gameId");

-- AddForeignKey
ALTER TABLE "TeamSourceAlias" ADD CONSTRAINT "TeamSourceAlias_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rivalry" ADD CONSTRAINT "Rivalry_teamAId_fkey" FOREIGN KEY ("teamAId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rivalry" ADD CONSTRAINT "Rivalry_teamBId_fkey" FOREIGN KEY ("teamBId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRatingWeekly" ADD CONSTRAINT "TeamRatingWeekly_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Line" ADD CONSTRAINT "Line_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Weather" ADD CONSTRAINT "Weather_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Injury" ADD CONSTRAINT "Injury_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Injury" ADD CONSTRAINT "Injury_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelPrediction" ADD CONSTRAINT "ModelPrediction_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameFlag" ADD CONSTRAINT "GameFlag_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameFlag" ADD CONSTRAINT "GameFlag_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pick" ADD CONSTRAINT "Pick_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

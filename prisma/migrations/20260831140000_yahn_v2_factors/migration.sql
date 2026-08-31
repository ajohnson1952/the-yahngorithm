-- CreateTable
CREATE TABLE "TeamTalent" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "talent" DOUBLE PRECISION NOT NULL,
    "pulledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamTalent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamReturningProduction" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "percentPPA" DOUBLE PRECISION,
    "percentPassingPPA" DOUBLE PRECISION,
    "percentReceivingPPA" DOUBLE PRECISION,
    "percentRushingPPA" DOUBLE PRECISION,
    "totalPPA" DOUBLE PRECISION,
    "usage" DOUBLE PRECISION,
    "pulledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamReturningProduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamAdvancedWeekly" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "offSuccess" DOUBLE PRECISION,
    "defSuccess" DOUBLE PRECISION,
    "offExplosive" DOUBLE PRECISION,
    "defExplosive" DOUBLE PRECISION,
    "offPPA" DOUBLE PRECISION,
    "defPPA" DOUBLE PRECISION,
    "offPPO" DOUBLE PRECISION,
    "defPPO" DOUBLE PRECISION,
    "offHavoc" DOUBLE PRECISION,
    "defHavoc" DOUBLE PRECISION,
    "offFieldPos" DOUBLE PRECISION,
    "defFieldPos" DOUBLE PRECISION,
    "pulledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamAdvancedWeekly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalEntry" (
    "id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "playerName" TEXT NOT NULL,
    "position" TEXT,
    "origin" TEXT,
    "originTeamId" TEXT,
    "destination" TEXT,
    "destTeamId" TEXT,
    "rating" DOUBLE PRECISION,
    "stars" INTEGER,
    "eligibility" TEXT,
    "transferDate" TIMESTAMP(3),

    CONSTRAINT "PortalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamPortalNet" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "inCount" INTEGER NOT NULL DEFAULT 0,
    "outCount" INTEGER NOT NULL DEFAULT 0,
    "inScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamPortalNet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamHfa" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "hfa" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamHfa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamTalent_season_idx" ON "TeamTalent"("season");

-- CreateIndex
CREATE UNIQUE INDEX "TeamTalent_teamId_season_key" ON "TeamTalent"("teamId", "season");

-- CreateIndex
CREATE INDEX "TeamReturningProduction_season_idx" ON "TeamReturningProduction"("season");

-- CreateIndex
CREATE UNIQUE INDEX "TeamReturningProduction_teamId_season_key" ON "TeamReturningProduction"("teamId", "season");

-- CreateIndex
CREATE INDEX "TeamAdvancedWeekly_season_week_idx" ON "TeamAdvancedWeekly"("season", "week");

-- CreateIndex
CREATE UNIQUE INDEX "TeamAdvancedWeekly_teamId_season_week_key" ON "TeamAdvancedWeekly"("teamId", "season", "week");

-- CreateIndex
CREATE INDEX "PortalEntry_season_idx" ON "PortalEntry"("season");

-- CreateIndex
CREATE INDEX "PortalEntry_destTeamId_idx" ON "PortalEntry"("destTeamId");

-- CreateIndex
CREATE INDEX "PortalEntry_originTeamId_idx" ON "PortalEntry"("originTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalEntry_season_playerName_position_origin_key" ON "PortalEntry"("season", "playerName", "position", "origin");

-- CreateIndex
CREATE INDEX "TeamPortalNet_season_idx" ON "TeamPortalNet"("season");

-- CreateIndex
CREATE UNIQUE INDEX "TeamPortalNet_teamId_season_key" ON "TeamPortalNet"("teamId", "season");

-- CreateIndex
CREATE UNIQUE INDEX "TeamHfa_teamId_key" ON "TeamHfa"("teamId");

-- AddForeignKey
ALTER TABLE "TeamTalent" ADD CONSTRAINT "TeamTalent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamReturningProduction" ADD CONSTRAINT "TeamReturningProduction_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamAdvancedWeekly" ADD CONSTRAINT "TeamAdvancedWeekly_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalEntry" ADD CONSTRAINT "PortalEntry_originTeamId_fkey" FOREIGN KEY ("originTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalEntry" ADD CONSTRAINT "PortalEntry_destTeamId_fkey" FOREIGN KEY ("destTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamPortalNet" ADD CONSTRAINT "TeamPortalNet_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamHfa" ADD CONSTRAINT "TeamHfa_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


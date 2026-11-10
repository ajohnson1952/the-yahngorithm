-- CreateTable
CREATE TABLE "CbbTeam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "division" TEXT NOT NULL DEFAULT 'd1',
    "cbbdId" INTEGER,
    "espnId" INTEGER,
    "conference" TEXT,
    "abbreviation" TEXT,
    "logo" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CbbTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CbbTeamAlias" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'needs_review',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CbbTeamAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CbbGame" (
    "id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "espnId" INTEGER,
    "startTime" TIMESTAMP(3) NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "neutralSite" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CbbGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CbbLine" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "book" TEXT NOT NULL DEFAULT 'fanduel',
    "market" TEXT NOT NULL,
    "homeValue" DOUBLE PRECISION,
    "homePrice" INTEGER,
    "awayPrice" INTEGER,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CbbLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CbbTeam_name_key" ON "CbbTeam"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CbbTeam_cbbdId_key" ON "CbbTeam"("cbbdId");

-- CreateIndex
CREATE UNIQUE INDEX "CbbTeam_espnId_key" ON "CbbTeam"("espnId");

-- CreateIndex
CREATE INDEX "CbbTeamAlias_teamId_idx" ON "CbbTeamAlias"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "CbbTeamAlias_source_alias_key" ON "CbbTeamAlias"("source", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "CbbGame_espnId_key" ON "CbbGame"("espnId");

-- CreateIndex
CREATE INDEX "CbbGame_startTime_idx" ON "CbbGame"("startTime");

-- CreateIndex
CREATE INDEX "CbbLine_gameId_capturedAt_idx" ON "CbbLine"("gameId", "capturedAt");

-- AddForeignKey
ALTER TABLE "CbbTeamAlias" ADD CONSTRAINT "CbbTeamAlias_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "CbbTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbbGame" ADD CONSTRAINT "CbbGame_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "CbbTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbbGame" ADD CONSTRAINT "CbbGame_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "CbbTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CbbLine" ADD CONSTRAINT "CbbLine_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "CbbGame"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


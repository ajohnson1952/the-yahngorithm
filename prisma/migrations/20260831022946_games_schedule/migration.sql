-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "neutralSite" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "classification" TEXT NOT NULL DEFAULT 'fbs';

-- CreateIndex
CREATE UNIQUE INDEX "Game_season_week_homeTeamId_awayTeamId_key" ON "Game"("season", "week", "homeTeamId", "awayTeamId");


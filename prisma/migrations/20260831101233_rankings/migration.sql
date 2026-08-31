-- CreateTable
CREATE TABLE "Ranking" (
    "id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "poll" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "points" INTEGER,
    "firstPlaceVotes" INTEGER,

    CONSTRAINT "Ranking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ranking_season_week_idx" ON "Ranking"("season", "week");

-- CreateIndex
CREATE UNIQUE INDEX "Ranking_season_week_poll_teamId_key" ON "Ranking"("season", "week", "poll", "teamId");

-- AddForeignKey
ALTER TABLE "Ranking" ADD CONSTRAINT "Ranking_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


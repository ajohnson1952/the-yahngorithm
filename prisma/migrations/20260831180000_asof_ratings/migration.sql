-- CreateTable
CREATE TABLE "TeamRatingAsOf" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "throughWeek" INTEGER NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "gamesUsed" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamRatingAsOf_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamRatingAsOf_season_throughWeek_idx" ON "TeamRatingAsOf"("season", "throughWeek");

-- CreateIndex
CREATE UNIQUE INDEX "TeamRatingAsOf_teamId_season_throughWeek_key" ON "TeamRatingAsOf"("teamId", "season", "throughWeek");

-- AddForeignKey
ALTER TABLE "TeamRatingAsOf" ADD CONSTRAINT "TeamRatingAsOf_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


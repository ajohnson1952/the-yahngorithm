-- AlterTable
ALTER TABLE "ModelPrediction" ADD COLUMN     "predictedSpreadYahn" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "YahnRanking" (
    "id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "teamId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YahnRanking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YahnRanking_season_teamId_key" ON "YahnRanking"("season", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "YahnRanking_season_rank_key" ON "YahnRanking"("season", "rank");

-- AddForeignKey
ALTER TABLE "YahnRanking" ADD CONSTRAINT "YahnRanking_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


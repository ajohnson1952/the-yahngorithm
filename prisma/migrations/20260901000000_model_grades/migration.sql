-- CreateTable
CREATE TABLE "ModelGrade" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "predMargin" DOUBLE PRECISION,
    "closeMargin" DOUBLE PRECISION NOT NULL,
    "actualMargin" DOUBLE PRECISION NOT NULL,
    "side" INTEGER NOT NULL,
    "edge" DOUBLE PRECISION,
    "result" TEXT NOT NULL,
    "absError" DOUBLE PRECISION,
    "gradedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelGrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelGrade_season_week_idx" ON "ModelGrade"("season", "week");

-- CreateIndex
CREATE UNIQUE INDEX "ModelGrade_gameId_key_key" ON "ModelGrade"("gameId", "key");

-- AddForeignKey
ALTER TABLE "ModelGrade" ADD CONSTRAINT "ModelGrade_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


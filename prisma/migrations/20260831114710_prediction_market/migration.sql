-- CreateTable
CREATE TABLE "PredictionMarket" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'kalshi',
    "homeWinProb" DOUBLE PRECISION NOT NULL,
    "homePrevProb" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION NOT NULL,
    "volume24h" DOUBLE PRECISION NOT NULL,
    "openInterest" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionMarket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PredictionMarket_gameId_idx" ON "PredictionMarket"("gameId");

-- AddForeignKey
ALTER TABLE "PredictionMarket" ADD CONSTRAINT "PredictionMarket_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


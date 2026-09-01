-- CreateTable
CREATE TABLE "PinnedGame" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "pinnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinnedGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PinnedGame_gameId_key" ON "PinnedGame"("gameId");

-- AddForeignKey
ALTER TABLE "PinnedGame" ADD CONSTRAINT "PinnedGame_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


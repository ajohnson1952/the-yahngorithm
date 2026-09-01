-- DropIndex
DROP INDEX "PinnedGame_gameId_key";

-- AlterTable
ALTER TABLE "PinnedGame" ADD COLUMN     "uid" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "PinnedGame_uid_idx" ON "PinnedGame"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "PinnedGame_gameId_uid_key" ON "PinnedGame"("gameId", "uid");


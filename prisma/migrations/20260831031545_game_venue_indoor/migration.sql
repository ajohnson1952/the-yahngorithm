-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "indoor" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "venueId" INTEGER;

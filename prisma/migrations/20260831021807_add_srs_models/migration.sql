/*
  Warnings:

  - You are about to drop the column `predictedSpread` on the `ModelPrediction` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ModelPrediction" DROP COLUMN "predictedSpread",
ADD COLUMN     "predictedSpreadSpPlus" DOUBLE PRECISION,
ADD COLUMN     "predictedSpreadSrs" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Pick" ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'sp_plus';

-- AlterTable
ALTER TABLE "TeamRatingWeekly" ADD COLUMN     "srs" DOUBLE PRECISION;

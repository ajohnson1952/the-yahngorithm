-- CreateTable
CREATE TABLE "ApiUsage" (
    "id" TEXT NOT NULL,
    "api" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "lastRemaining" INTEGER,
    "lastCost" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiUsage_api_yearMonth_key" ON "ApiUsage"("api", "yearMonth");


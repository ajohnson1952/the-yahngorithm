-- CreateTable
CREATE TABLE "Meta" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meta_pkey" PRIMARY KEY ("key")
);


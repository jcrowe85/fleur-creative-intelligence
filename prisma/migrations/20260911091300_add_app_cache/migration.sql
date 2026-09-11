-- CreateTable
CREATE TABLE "AppCache" (
    "key" TEXT NOT NULL,
    "json" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppCache_pkey" PRIMARY KEY ("key")
);

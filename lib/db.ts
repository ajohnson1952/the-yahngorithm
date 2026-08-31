// Prisma client singleton — avoids exhausting DB connections during dev
// hot-reload. Used by the Next.js app (server components / route handlers).
// The pipeline scripts create their own short-lived PrismaClient instead.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

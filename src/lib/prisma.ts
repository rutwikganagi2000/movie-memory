import "server-only";
import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across hot reloads in development; otherwise
// every reload would open a new connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

import type { PrismaClient } from "@prisma/client";
import type { FactRepository } from "./service";

export function createPrismaFactRepository(prisma: PrismaClient): FactRepository {
  return {
    async getFavoriteMovie(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { favoriteMovie: true },
      });
      return user ? user.favoriteMovie : undefined;
    },

    findLatestFact(userId, movie) {
      return prisma.movieFact.findFirst({
        where: { userId, movie },
        orderBy: { createdAt: "desc" },
      });
    },

    createFact(data) {
      return prisma.movieFact.create({ data });
    },

    async tryAcquireLock(userId, token, now, expiresAt) {
      // A single atomic statement acts as compare-and-set:
      //  - no row yet         -> INSERT succeeds, we own the lease
      //  - row, lease expired -> ON CONFLICT ... DO UPDATE (WHERE true), we own it
      //  - row, lease active  -> WHERE false, no row returned, someone else owns it
      // Concurrent callers racing on the same userId are serialized by the
      // primary-key index, so exactly one of them sees a returned row.
      const rows = await prisma.$queryRaw<{ token: string }[]>`
        INSERT INTO "FactGenerationLock" ("userId", "token", "expiresAt")
        VALUES (${userId}, ${token}, ${expiresAt})
        ON CONFLICT ("userId") DO UPDATE
          SET "token" = EXCLUDED."token", "expiresAt" = EXCLUDED."expiresAt"
          WHERE "FactGenerationLock"."expiresAt" < ${now}
        RETURNING "token"
      `;
      return rows.length === 1 && rows[0].token === token;
    },

    async releaseLock(userId, token) {
      // Token check: if our lease expired and someone else took it, we must
      // not delete *their* lease.
      await prisma.factGenerationLock.deleteMany({ where: { userId, token } });
    },
  };
}

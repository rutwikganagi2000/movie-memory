import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaFactRepository } from "@/lib/facts/prisma-repository";
import { getFactForUser } from "@/lib/facts/service";

/**
 * Runs against a real Postgres (TEST_DATABASE_URL) to prove the lease SQL is
 * atomic under true concurrency — something the in-memory fake can't show.
 * Skipped when TEST_DATABASE_URL is not set.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Postgres lease + fact service (integration)", () => {
  const prisma = new PrismaClient({ datasourceUrl: url });
  const repo = createPrismaFactRepository(prisma);
  let userId: string;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: "@integration.test" } } });
    const user = await prisma.user.create({
      data: { email: `${crypto.randomUUID()}@integration.test`, favoriteMovie: "Arrival" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: "@integration.test" } } });
    await prisma.$disconnect();
  });

  it("exactly one of many concurrent acquirers wins the lease", async () => {
    const now = new Date();
    const expires = new Date(now.getTime() + 30_000);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => repo.tryAcquireLock(userId, `t${i}`, now, expires)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("an expired lease can be taken over; an active one cannot", async () => {
    const now = new Date();
    expect(await repo.tryAcquireLock(userId, "a", now, new Date(now.getTime() - 1))).toBe(true); // already expired
    expect(await repo.tryAcquireLock(userId, "b", now, new Date(now.getTime() + 30_000))).toBe(true);
    expect(await repo.tryAcquireLock(userId, "c", now, new Date(now.getTime() + 30_000))).toBe(false);
  });

  it("release only deletes the lease when the token matches", async () => {
    const now = new Date();
    await repo.tryAcquireLock(userId, "mine", now, new Date(now.getTime() + 30_000));
    await repo.releaseLock(userId, "not-mine");
    expect(await prisma.factGenerationLock.count({ where: { userId } })).toBe(1);
    await repo.releaseLock(userId, "mine");
    expect(await prisma.factGenerationLock.count({ where: { userId } })).toBe(0);
  });

  it("concurrent fact requests generate and store exactly one fact", async () => {
    const generateFact = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 200));
      return "Arrival's alien script was designed by an artist.";
    });
    const deps = {
      repo,
      generateFact,
      now: () => new Date(),
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      newToken: () => crypto.randomUUID(),
    };

    const results = await Promise.all(Array.from({ length: 8 }, () => getFactForUser(userId, deps)));

    expect(generateFact).toHaveBeenCalledOnce();
    expect(await prisma.movieFact.count({ where: { userId } })).toBe(1);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

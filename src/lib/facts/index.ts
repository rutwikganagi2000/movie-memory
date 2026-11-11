import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { generateMovieFact } from "@/lib/openai";
import { createPrismaFactRepository } from "./prisma-repository";
import { getFactForUser, type FactResult } from "./service";

const repo = createPrismaFactRepository(prisma);

/** Production wiring of the fact service. */
export function getFact(userId: string): Promise<FactResult> {
  return getFactForUser(userId, {
    repo,
    generateFact: generateMovieFact,
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    newToken: randomUUID,
    logError: (message, error) =>
      console.error(`[facts] ${message}:`, error instanceof Error ? error.message : error),
  });
}

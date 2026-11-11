import type { FactRepository, StoredFact } from "@/lib/facts/service";

/**
 * In-memory FactRepository with the same semantics as the Prisma one.
 * tryAcquireLock is synchronous inside, so it is atomic on the JS event loop,
 * mirroring the single-statement compare-and-set in Postgres.
 */
export class InMemoryFactRepository implements FactRepository {
  users = new Map<string, { favoriteMovie: string | null }>();
  facts: StoredFact[] = [];
  locks = new Map<string, { token: string; expiresAt: Date }>();
  private seq = 0;

  addUser(id: string, favoriteMovie: string | null) {
    this.users.set(id, { favoriteMovie });
  }

  addFact(fact: Omit<StoredFact, "id">): StoredFact {
    const stored = { ...fact, id: `fact_${++this.seq}` };
    this.facts.push(stored);
    return stored;
  }

  async getFavoriteMovie(userId: string) {
    const user = this.users.get(userId);
    return user ? user.favoriteMovie : undefined;
  }

  async findLatestFact(userId: string, movie: string) {
    const matches = this.facts
      .filter((f) => f.userId === userId && f.movie === movie)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
  }

  async createFact(data: Omit<StoredFact, "id">) {
    return this.addFact(data);
  }

  async tryAcquireLock(userId: string, token: string, now: Date, expiresAt: Date) {
    const existing = this.locks.get(userId);
    if (existing && existing.expiresAt >= now) return false;
    this.locks.set(userId, { token, expiresAt });
    return true;
  }

  async releaseLock(userId: string, token: string) {
    if (this.locks.get(userId)?.token === token) this.locks.delete(userId);
  }
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFactForUser, type FactServiceDeps } from "@/lib/facts/service";
import { FACT_CACHE_WINDOW_MS, LOCK_LEASE_MS } from "@/lib/facts/constants";
import { InMemoryFactRepository } from "./helpers/in-memory-repo";

const T0 = new Date("2026-01-01T12:00:00.000Z");
const at = (msAfterT0: number) => new Date(T0.getTime() + msAfterT0);

let repo: InMemoryFactRepository;
let clock: Date;
let tokenSeq: number;

function makeDeps(overrides: Partial<FactServiceDeps> = {}): FactServiceDeps {
  return {
    repo,
    generateFact: vi.fn(async (movie: string) => `A fresh fact about ${movie}`),
    now: () => clock,
    // Yield to the event loop so concurrent requests interleave realistically.
    sleep: () => new Promise((r) => setTimeout(r, 0)),
    newToken: () => `token_${++tokenSeq}`,
    ...overrides,
  };
}

beforeEach(() => {
  repo = new InMemoryFactRepository();
  repo.addUser("alice", "Inception");
  repo.addUser("bob", "Inception");
  clock = T0;
  tokenSeq = 0;
});

describe("60-second cache window", () => {
  it("generates and stores a fact when none exists", async () => {
    const deps = makeDeps();
    const result = await getFactForUser("alice", deps);

    expect(result).toMatchObject({ ok: true, source: "generated" });
    expect(deps.generateFact).toHaveBeenCalledOnce();
    expect(deps.generateFact).toHaveBeenCalledWith("Inception");
    expect(repo.facts).toHaveLength(1);
    expect(repo.facts[0]).toMatchObject({ userId: "alice", movie: "Inception", createdAt: T0 });
  });

  it("returns the cached fact when it is less than 60s old", async () => {
    const cached = repo.addFact({ userId: "alice", movie: "Inception", content: "cached", createdAt: T0 });
    clock = at(FACT_CACHE_WINDOW_MS - 1); // 59.999s later
    const deps = makeDeps();

    const result = await getFactForUser("alice", deps);

    expect(result).toEqual({ ok: true, fact: cached, source: "cache" });
    expect(deps.generateFact).not.toHaveBeenCalled();
  });

  it("generates a new fact at exactly 60s (boundary is exclusive)", async () => {
    repo.addFact({ userId: "alice", movie: "Inception", content: "old", createdAt: T0 });
    clock = at(FACT_CACHE_WINDOW_MS);
    const deps = makeDeps();

    const result = await getFactForUser("alice", deps);

    expect(result).toMatchObject({ ok: true, source: "generated" });
    expect(deps.generateFact).toHaveBeenCalledOnce();
    expect(repo.facts).toHaveLength(2);
  });

  it("uses the most recent fact to decide freshness", async () => {
    repo.addFact({ userId: "alice", movie: "Inception", content: "older", createdAt: at(-120_000) });
    const newest = repo.addFact({ userId: "alice", movie: "Inception", content: "newest", createdAt: at(-10_000) });
    const deps = makeDeps();

    const result = await getFactForUser("alice", deps);

    expect(result).toEqual({ ok: true, fact: newest, source: "cache" });
  });

  it("does not reuse a fresh fact generated for a different movie", async () => {
    repo.addFact({ userId: "alice", movie: "Alien", content: "about Alien", createdAt: T0 });
    const deps = makeDeps();

    const result = await getFactForUser("alice", deps);

    expect(result).toMatchObject({ ok: true, source: "generated", fact: { movie: "Inception" } });
  });

  it("serves from cache on subsequent calls inside the window, then regenerates after it", async () => {
    const deps = makeDeps();
    await getFactForUser("alice", deps);
    clock = at(30_000);
    await getFactForUser("alice", deps);
    clock = at(59_000);
    await getFactForUser("alice", deps);
    expect(deps.generateFact).toHaveBeenCalledTimes(1);

    clock = at(61_000);
    const result = await getFactForUser("alice", deps);
    expect(result).toMatchObject({ source: "generated" });
    expect(deps.generateFact).toHaveBeenCalledTimes(2);
  });
});

describe("authorization / user isolation", () => {
  it("never returns another user's fact, even for the same movie", async () => {
    repo.addFact({ userId: "bob", movie: "Inception", content: "bob's secret fact", createdAt: T0 });
    const deps = makeDeps();

    const result = await getFactForUser("alice", deps);

    expect(result.ok && result.fact.userId).toBe("alice");
    expect(result.ok && result.fact.content).not.toBe("bob's secret fact");
    expect(deps.generateFact).toHaveBeenCalledOnce();
  });

  it("never falls back to another user's fact when generation fails", async () => {
    repo.addFact({ userId: "bob", movie: "Inception", content: "bob's fact", createdAt: at(-120_000) });
    const deps = makeDeps({ generateFact: vi.fn().mockRejectedValue(new Error("down")) });

    const result = await getFactForUser("alice", deps);

    expect(result).toEqual({ ok: false, error: "GENERATION_FAILED" });
  });

  it("one user's in-flight generation does not block another user", async () => {
    repo.locks.set("bob", { token: "bobs", expiresAt: at(LOCK_LEASE_MS) });
    const result = await getFactForUser("alice", makeDeps());
    expect(result).toMatchObject({ ok: true, source: "generated" });
  });

  it("reports unknown users and users without a movie", async () => {
    repo.addUser("carol", null);
    expect(await getFactForUser("nobody", makeDeps())).toEqual({ ok: false, error: "USER_NOT_FOUND" });
    expect(await getFactForUser("carol", makeDeps())).toEqual({ ok: false, error: "NO_FAVORITE_MOVIE" });
  });
});

describe("burst / idempotency protection", () => {
  it("concurrent requests with no prior fact trigger exactly one generation", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const generateFact = vi.fn(async () => {
      await gate;
      return "the only fact";
    });
    const deps = makeDeps({ generateFact });

    const requests = Array.from({ length: 5 }, () => getFactForUser("alice", deps));
    await new Promise((r) => setTimeout(r, 5));
    release();
    const results = await Promise.all(requests);

    expect(generateFact).toHaveBeenCalledOnce();
    expect(repo.facts).toHaveLength(1);
    for (const r of results) expect(r).toMatchObject({ ok: true, fact: { content: "the only fact" } });
    expect(results.filter((r) => r.ok && r.source === "generated")).toHaveLength(1);
  });

  it("while a generation is in flight, other requests get the previous fact immediately", async () => {
    const previous = repo.addFact({ userId: "alice", movie: "Inception", content: "previous", createdAt: at(-120_000) });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const generateFact = vi.fn(async () => {
      await gate;
      return "new";
    });
    const deps = makeDeps({ generateFact });

    const first = getFactForUser("alice", deps);
    await new Promise((r) => setTimeout(r, 0));
    const second = await getFactForUser("alice", deps);

    expect(second).toEqual({ ok: true, fact: previous, source: "in_progress" });
    release();
    expect(await first).toMatchObject({ source: "generated", fact: { content: "new" } });
    expect(generateFact).toHaveBeenCalledOnce();
  });

  it("re-checks the cache after acquiring the lease (double-checked)", async () => {
    // Simulate: our first read saw a stale fact, but another request finished
    // generating before we acquired the lease.
    const fresh = { id: "f", userId: "alice", movie: "Inception", content: "just made", createdAt: T0 };
    const stale = { ...fresh, id: "s", content: "stale", createdAt: at(-120_000) };
    vi.spyOn(repo, "findLatestFact").mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
    const deps = makeDeps();

    const result = await getFactForUser("alice", deps);

    expect(result).toEqual({ ok: true, fact: fresh, source: "cache" });
    expect(deps.generateFact).not.toHaveBeenCalled();
    expect(repo.locks.size).toBe(0);
  });

  it("an expired lease (crashed request) does not block generation forever", async () => {
    repo.locks.set("alice", { token: "crashed", expiresAt: at(-1) });
    const result = await getFactForUser("alice", makeDeps());
    expect(result).toMatchObject({ ok: true, source: "generated" });
  });

  it("gives up waiting with a retryable error if the in-flight generation never lands", async () => {
    repo.locks.set("alice", { token: "other", expiresAt: at(LOCK_LEASE_MS) });
    const deps = makeDeps();

    const result = await getFactForUser("alice", deps);

    expect(result).toEqual({ ok: false, error: "GENERATION_IN_PROGRESS" });
    expect(deps.generateFact).not.toHaveBeenCalled();
  });
});

describe("OpenAI failure handling", () => {
  it("returns the most recent cached fact when generation fails", async () => {
    const old = repo.addFact({ userId: "alice", movie: "Inception", content: "old", createdAt: at(-300_000) });
    const logError = vi.fn();
    const deps = makeDeps({ generateFact: vi.fn().mockRejectedValue(new Error("timeout")), logError });

    const result = await getFactForUser("alice", deps);

    expect(result).toEqual({ ok: true, fact: old, source: "stale_fallback" });
    expect(logError).toHaveBeenCalledOnce();
    expect(repo.facts).toHaveLength(1);
  });

  it("returns an error code when generation fails and nothing is cached", async () => {
    const deps = makeDeps({ generateFact: vi.fn().mockRejectedValue(new Error("500")) });
    expect(await getFactForUser("alice", deps)).toEqual({ ok: false, error: "GENERATION_FAILED" });
  });

  it("releases the lease after a failure so the next request can retry", async () => {
    const generateFact = vi.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValueOnce("recovered");
    const deps = makeDeps({ generateFact });

    expect(await getFactForUser("alice", deps)).toEqual({ ok: false, error: "GENERATION_FAILED" });
    expect(repo.locks.size).toBe(0);
    expect(await getFactForUser("alice", deps)).toMatchObject({ ok: true, source: "generated" });
  });
});

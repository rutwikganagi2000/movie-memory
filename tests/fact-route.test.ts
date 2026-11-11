import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFactForUser } from "@/lib/facts/service";
import { InMemoryFactRepository } from "./helpers/in-memory-repo";

// The route's two dependencies: the session lookup and the fact service.
// We fake the session, and run the *real* service against an in-memory repo.
const mocks = vi.hoisted(() => ({
  sessionUserId: null as string | null,
  repo: null as unknown as InMemoryFactRepository,
  generateFact: null as unknown as (movie: string) => Promise<string>,
}));

vi.mock("@/lib/auth", () => ({
  getSessionUserId: async () => mocks.sessionUserId,
}));

vi.mock("@/lib/facts", () => ({
  getFact: (userId: string) =>
    getFactForUser(userId, {
      repo: mocks.repo,
      generateFact: mocks.generateFact,
      now: () => new Date(),
      sleep: async () => {},
      newToken: () => crypto.randomUUID(),
    }),
}));

const { GET } = await import("@/app/api/fact/route");

beforeEach(() => {
  mocks.repo = new InMemoryFactRepository();
  mocks.repo.addUser("alice", "Inception");
  mocks.repo.addUser("bob", "Heat");
  mocks.repo.addFact({ userId: "bob", movie: "Heat", content: "bob's private fact", createdAt: new Date() });
  mocks.generateFact = vi.fn(async (movie: string) => `fact about ${movie}`);
  mocks.sessionUserId = null;
});

describe("GET /api/fact authorization", () => {
  it("returns 401 when not signed in and does no work", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Please sign in." } });
    expect(mocks.generateFact).not.toHaveBeenCalled();
  });

  it("returns only the signed-in user's fact", async () => {
    mocks.sessionUserId = "alice";
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.fact).toMatchObject({ movie: "Inception", content: "fact about Inception" });
    expect(JSON.stringify(body)).not.toContain("bob");
    expect(body.fact).not.toHaveProperty("userId");
  });

  it("has no parameter that selects a user: the handler takes no request input", () => {
    // GET() is declared without a Request argument, so query strings like
    // ?userId=bob are structurally impossible to honor.
    expect(GET.length).toBe(0);
  });

  it("a user's cached fact is not visible to a different user", async () => {
    mocks.sessionUserId = "bob";
    const bobRes = await (await GET()).json();
    expect(bobRes).toMatchObject({ source: "cache", fact: { content: "bob's private fact" } });

    mocks.sessionUserId = "alice";
    const aliceRes = await (await GET()).json();
    expect(aliceRes.fact.content).not.toBe("bob's private fact");
  });

  it("sets Cache-Control: no-store on per-user responses", async () => {
    mocks.sessionUserId = "alice";
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/fact error mapping", () => {
  it("returns 503 with a friendly message when OpenAI fails and nothing is cached", async () => {
    mocks.sessionUserId = "alice";
    mocks.generateFact = vi.fn().mockRejectedValue(new Error("timeout"));

    const res = await GET();

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect((await res.json()).error.code).toBe("GENERATION_FAILED");
  });

  it("returns 409 when the user has not picked a movie", async () => {
    mocks.repo.addUser("carol", null);
    mocks.sessionUserId = "carol";
    const res = await GET();
    expect(res.status).toBe(409);
  });
});

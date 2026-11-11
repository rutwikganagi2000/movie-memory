import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getFact } from "@/lib/facts";
import type { FactErrorCode } from "@/lib/facts/service";
import type { FactResponse } from "@/lib/facts/api-types";

export const dynamic = "force-dynamic";

const ERRORS: Record<FactErrorCode | "UNAUTHORIZED", { status: number; message: string }> = {
  UNAUTHORIZED: { status: 401, message: "Please sign in." },
  USER_NOT_FOUND: { status: 401, message: "Please sign in." },
  NO_FAVORITE_MOVIE: { status: 409, message: "Pick a favorite movie first." },
  GENERATION_FAILED: {
    status: 503,
    message: "We couldn't come up with a fact right now. Please try again in a moment.",
  },
  GENERATION_IN_PROGRESS: {
    status: 503,
    message: "Your fact is still being generated. Please try again in a moment.",
  },
};

function json(body: FactResponse, status = 200, headers: Record<string, string> = {}) {
  // Per-user, time-sensitive data: never let a browser or CDN cache it.
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * GET /api/fact — fact for the *signed-in* user's favorite movie.
 *
 * Authorization: the user is identified solely by the server-side session.
 * The endpoint accepts no user id (query params/body are ignored), so there
 * is no way to request another user's facts.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    const e = ERRORS.UNAUTHORIZED;
    return json({ error: { code: "UNAUTHORIZED", message: e.message } }, e.status);
  }

  const result = await getFact(userId);
  if (!result.ok) {
    const e = ERRORS[result.error];
    const headers: Record<string, string> = e.status === 503 ? { "Retry-After": "5" } : {};
    return json({ error: { code: result.error, message: e.message } }, e.status, headers);
  }

  const { content, movie, createdAt } = result.fact;
  return json({
    fact: { content, movie, createdAt: createdAt.toISOString() },
    source: result.source,
  });
}

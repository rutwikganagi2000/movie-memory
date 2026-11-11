"use server";

import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { movieTitleSchema } from "@/lib/validation";

export type OnboardingState = { error?: string; value?: string };

/**
 * Saves the favorite movie for the signed-in user.
 * - Identity comes from the session, never from the form.
 * - Validation is authoritative here (the client only hints via maxLength).
 * - Onboarding is first-time only: the update applies only while
 *   favoriteMovie is still null, so a replayed request can't overwrite it.
 */
export async function saveFavoriteMovie(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const raw = formData.get("movie");
  const parsed = movieTitleSchema.safeParse(typeof raw === "string" ? raw : "");
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid movie title.",
      value: typeof raw === "string" ? raw : "",
    };
  }

  await prisma.user.updateMany({
    where: { id: userId, favoriteMovie: null },
    data: { favoriteMovie: parsed.data },
  });

  redirect("/dashboard");
}

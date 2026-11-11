import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SignInButton } from "@/components/auth-buttons";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "Access was denied. Please try again.",
  OAuthAccountNotLinked: "This email is already linked to a different sign-in method.",
};

/**
 * Landing page, and the single post-login routing point: Google sign-in
 * returns here (callbackUrl "/"), and we route first-time users to onboarding
 * and returning users to the dashboard based on the database.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const userId = await getSessionUserId();
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { favoriteMovie: true },
    });
    redirect(user?.favoriteMovie ? "/dashboard" : "/onboarding");
  }

  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again.") : null;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <h1 className="text-3xl font-bold tracking-tight">🎬 Movie Memory</h1>
        <p className="mt-3 text-slate-600">
          Tell us your favorite movie and we&apos;ll serve up fun facts about it.
        </p>
        {errorMessage && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {errorMessage}
          </p>
        )}
        <div className="mt-8">
          <SignInButton />
        </div>
      </div>
    </main>
  );
}

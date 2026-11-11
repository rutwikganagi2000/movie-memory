import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const user = await requireUser();
  // First-time only: users who already picked a movie go straight to the dashboard.
  if (user.favoriteMovie) redirect("/dashboard");

  const firstName = user.name?.trim().split(/\s+/)[0];

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome{firstName ? `, ${firstName}` : ""}! 👋
        </h1>
        <p className="mt-2 text-slate-600">What&apos;s your favorite movie?</p>
        <OnboardingForm />
      </div>
    </main>
  );
}

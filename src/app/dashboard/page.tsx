import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { Avatar } from "@/components/avatar";
import { SignOutButton } from "@/components/auth-buttons";
import { FactCard } from "./fact-card";

export default async function DashboardPage() {
  // Not signed in -> redirected to "/" (the login page) inside requireUser.
  const user = await requireUser();
  if (!user.favoriteMovie) redirect("/onboarding");

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">🎬 Movie Memory</h1>
        <SignOutButton />
      </header>

      <section className="mt-8 flex items-center gap-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <Avatar image={user.image} name={user.name} email={user.email} />
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold">{user.name?.trim() || "Movie fan"}</p>
          {user.email && <p className="truncate text-slate-600">{user.email}</p>}
        </div>
      </section>

      <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">Favorite movie</p>
        <p className="mt-1 text-2xl font-bold break-words">{user.favoriteMovie}</p>
      </section>

      <FactCard />
    </main>
  );
}

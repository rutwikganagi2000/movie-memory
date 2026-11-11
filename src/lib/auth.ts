import "server-only";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  // Database sessions: the session cookie is an opaque token looked up in
  // Postgres on every request, so sessions can be revoked server-side and no
  // user data is stored in the cookie.
  session: { strategy: "database" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  pages: {
    // Our landing page is the sign-in page.
    signIn: "/",
    error: "/",
  },
  callbacks: {
    session({ session, user }) {
      // Expose the internal user id to server code. This is the ONLY source
      // of identity used for authorization anywhere in the app.
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
};

/** The authenticated user's id, or null. Never trust ids from the client. */
export async function getSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

const currentUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  favoriteMovie: true,
} as const;

/**
 * For server components / actions: returns the current user's row or
 * redirects to the landing page if not signed in.
 */
export async function requireUser() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: currentUserSelect,
  });
  if (!user) redirect("/");
  return user;
}

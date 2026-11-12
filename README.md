# 🎬 Movie Memory

Sign in with Google, tell us your favorite movie, and get fun facts about it from OpenAI.

**Variant chosen: A — Backend-Focused (caching + correctness).** See [Why Variant A](#why-variant-a).

**Stack:** TypeScript · Next.js 15 (App Router) · React 19 · Tailwind CSS 4 · Postgres · Prisma 6 · NextAuth v4 (Google OAuth) · OpenAI API · Vitest

---

## Contents

1. [Setup](#setup)
2. [Environment variables](#environment-variables)
3. [Database migrations](#database-migrations)
4. [Running tests](#running-tests)
5. [Architecture overview](#architecture-overview)
6. [Why Variant A](#why-variant-a)
7. [Key tradeoffs](#key-tradeoffs)
8. [With 2 more hours](#with-2-more-hours)
9. [AI usage](#ai-usage)

---

## Setup

**Prerequisites:** Node.js 20+ and a Postgres database (local install, or `docker compose up -d` using the included `docker-compose.yml`).

```bash
# 1. Install dependencies (also runs `prisma generate`)
npm install

# 2. Configure environment
cp .env.example .env        # then fill in values (see below)

# 3. Create the database schema
npx prisma migrate dev      # or `npm run db:deploy` on a fresh/prod database

# 4. Run
npm run dev                 # http://localhost:3000
```

### Google OAuth credentials

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Configure the **OAuth consent screen** (External, add yourself as a test user).
3. **Create credentials → OAuth client ID → Web application**.
4. Authorized JavaScript origin: `http://localhost:3000`
5. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
6. Copy the Client ID and Client Secret into `.env`.

### OpenAI key

Create a key at <https://platform.openai.com/api-keys> and set `OPENAI_API_KEY`. The app still runs without it: fact generation fails gracefully with a friendly message, which is a handy way to see the failure path.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Postgres connection string, e.g. `postgresql://postgres:PASSWORD@localhost:5432/movie_memory?schema=public` |
| `NEXTAUTH_SECRET` | ✅ | Random secret for signing/encrypting auth cookies. Generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | ✅ | Base URL of the app, `http://localhost:3000` locally |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth client secret |
| `OPENAI_API_KEY` | ✅ | OpenAI API key (server-only) |
| `OPENAI_MODEL` | — | Defaults to `gpt-4o-mini` |
| `TEST_DATABASE_URL` | — | Separate database for the Postgres integration test; the test is skipped if unset |

None of these are prefixed `NEXT_PUBLIC_`, so none are ever bundled into client JavaScript. Modules that read secrets (`lib/openai.ts`, `lib/prisma.ts`, `lib/auth.ts`) import `server-only`, so importing them from a client component fails the build.

## Database migrations

Migrations live in `prisma/migrations/` and are committed.

```bash
npx prisma migrate dev          # development: apply migrations (and create new ones after schema edits)
npx prisma migrate deploy       # CI / production: apply committed migrations only
npx prisma studio               # optional: browse data in a GUI
```

## Running tests

```bash
npm test                        # unit + route tests (+ integration test if TEST_DATABASE_URL is set)
```

To enable the Postgres integration test, create a second database and apply migrations to it:

```bash
createdb movie_memory_test      # or: CREATE DATABASE movie_memory_test;
DATABASE_URL="<your TEST_DATABASE_URL>" npx prisma migrate deploy
```

Other checks: `npm run lint`, `npm run typecheck`, `npm run build`.

| Test file | What it covers |
| --- | --- |
| `tests/fact-service.test.ts` | 60s cache window (incl. the exact 60s boundary), per-movie keying, user isolation, burst protection (5 concurrent requests → 1 OpenAI call), double-checked cache, expired leases, OpenAI failure fallback, lease release on failure |
| `tests/fact-route.test.ts` | `GET /api/fact`: 401 when signed out, only the session user's data is returned, no user-selecting input exists, error → HTTP status mapping, `Cache-Control: no-store` |
| `tests/integration/prisma-lock.test.ts` | Real Postgres: 20 concurrent lease attempts → exactly 1 winner; expiry takeover; token-checked release; 8 concurrent fact requests → exactly 1 generation and 1 stored row |
| `tests/validation.test.ts` | Movie title trimming, whitespace collapsing, min/max length, control characters |

---

## Architecture overview

### Request flow

```
Browser
  │
  ├─ GET /            Server component. Signed out → landing page with "Sign in with Google".
  │                   Signed in → redirect to /onboarding (no movie yet) or /dashboard.
  │
  ├─ Google OAuth ──▶ /api/auth/*   (NextAuth, Prisma adapter, database sessions)
  │                   callbackUrl is "/", so "/" is the single post-login router.
  │
  ├─ /onboarding      Server component + server action `saveFavoriteMovie`
  │                   (Zod validation, identity from session, first-time only)
  │
  ├─ /dashboard       Server component: profile + movie read from the DB.
  │                   Renders <FactCard/> (client), which calls ↓
  │
  └─ GET /api/fact    Route handler → session user id → fact service
                                                          │
                       ┌──────────────────────────────────┤
                       ▼                                  ▼
                 FactRepository (Prisma/Postgres)    generateMovieFact (OpenAI)
```

### Code layout

```
src/
  app/
    page.tsx                      Landing + post-login routing
    onboarding/                   page, client form, server action
    dashboard/                    page (server), fact-card (client)
    api/auth/[...nextauth]/       NextAuth handler
    api/fact/route.ts             GET /api/fact: auth + HTTP mapping only
  lib/
    auth.ts                       NextAuth config, getSessionUserId(), requireUser()
    prisma.ts                     PrismaClient singleton
    openai.ts                     OpenAI call: timeout, no retries, prompt hygiene
    validation.ts                 Zod movie title schema
    facts/
      service.ts                  ★ Variant A logic: pure, dependency-injected
      prisma-repository.ts        Postgres implementation (atomic lease SQL)
      index.ts                    Production wiring (real repo, OpenAI, clock)
      constants.ts                60s window, timeouts, lease length
prisma/schema.prisma              Data model
tests/                            Vitest suites (see above)
```

The fact service (`lib/facts/service.ts`) is the core of Variant A. It has **no imports from Next, Prisma, or OpenAI**: it receives a repository, a generator function, and a clock. That keeps the caching and concurrency rules easy to read in one file and lets the tests control time and concurrency precisely.

### Data model

```
User ──1:N── MovieFact            User ──1:0..1── FactGenerationLock
 id                id                               userId (PK)
 name?             userId  (FK, cascade)            token
 email? (unique)   movie   (title snapshot)         expiresAt (timestamptz)
 image?            content
 favoriteMovie?    createdAt (timestamptz)
                   INDEX (userId, movie, createdAt DESC)
+ Account, Session, VerificationToken (standard NextAuth adapter tables)
```

Schema decisions:

- **`favoriteMovie` lives on `User`** (nullable). The product has exactly one favorite movie per user, so a separate table would add a join with no benefit. *Onboarded* is derived from `favoriteMovie IS NOT NULL` instead of a separate flag that could drift out of sync.
- **`MovieFact` is append-only and snapshots the `movie` title.** The cache key is `(userId, movie)`, as the spec says ("most recent fact for this user + movie"). If the movie ever changes, a fact about the old movie can never be served for the new one, and the history stays truthful.
- **Composite index `(userId, movie, createdAt DESC)`** matches the hot query exactly: "latest fact for this user and movie" is an index seek plus a one-row read.
- **`timestamptz` for `createdAt` and `expiresAt`.** Both are compared as instants (cache window, lease expiry). I found during testing that Prisma's default `timestamp` (no time zone) makes a row written by a non-UTC session look hours old.
- **`FactGenerationLock` is a separate table, one row per user.** It keeps the concurrency mechanism out of the `User` model, and the primary key on `userId` is what makes the lease atomic (see below).
- **`onDelete: Cascade`** everywhere off `User`, so deleting a user removes their sessions, facts, and lease.

### Fact generation: cache + concurrency

```
getFactForUser(userId):
  movie  ← user.favoriteMovie                         (none → NO_FAVORITE_MOVIE)
  latest ← newest fact for (userId, movie)
  if latest is < 60s old            → return latest   [source: cache]

  try to acquire the per-user lease (30s)
  ├─ NOT acquired (another request is generating):
  │    latest exists                → return latest   [source: in_progress]  (don't block)
  │    no fact at all               → poll ~12s for the in-flight result, else 503 retryable
  └─ acquired:
       re-read latest; if now < 60s old → return it   [double-checked; no OpenAI call]
       try OpenAI (10s timeout, 0 retries)
         ok   → insert fact, return it                 [source: generated]
         fail → latest exists ? return it               [source: stale_fallback]
                               : GENERATION_FAILED (503, friendly message)
       finally: release the lease (only if our token still owns it)
```

**Cache window.** A fact is fresh when `now - createdAt < 60_000ms`, strictly less than, so at exactly 60s a new fact is generated. The tests pin both sides of the boundary (59.999s → cache, 60.000s → generate).

**Burst protection: a DB lease (the "generation in progress flag" / "DB transaction guard" options).** Acquiring the lease is a single atomic statement:

```sql
INSERT INTO "FactGenerationLock" ("userId","token","expiresAt") VALUES ($1,$2,$3)
ON CONFLICT ("userId") DO UPDATE SET "token"=EXCLUDED."token", "expiresAt"=EXCLUDED."expiresAt"
  WHERE "FactGenerationLock"."expiresAt" < $now
RETURNING "token";
```

- No row → the insert wins. Expired row → the update wins. Active row → the `WHERE` fails and nothing is returned, so the caller doesn't get the lease.
- Concurrent callers for the same user are serialized by Postgres on the primary key, so **exactly one** of them gets a row back. The integration test proves this with 20 parallel attempts.
- Why a lease and not a transaction or advisory lock held across the OpenAI call? Holding a DB transaction open for up to 10s of network I/O pins a pooled connection per in-flight request. The lease is held only between two short statements.
- **Expiry (30s > 10s OpenAI timeout)** means a crashed or killed request can block generation for that user for at most 30s, never forever.
- **Token-checked release** (`DELETE … WHERE userId=$1 AND token=$2`) means a request whose lease expired can't delete a newer request's lease.
- **Double-check after acquiring:** request A can finish and release between request B's first read and B acquiring the lease. B re-reads, sees A's fresh fact, and returns it instead of generating a duplicate.
- It works across multiple server instances, because the state lives in Postgres rather than in process memory.

**Why losers return the previous fact instead of waiting.** "Refresh quickly" and "multiple tabs" are exactly the cases where the user already has a perfectly good fact. Serving it immediately is faster and needs no long-held connections. Losers only wait (by short polling) when there is no fact to show at all, i.e. the very first load.

**Safe OpenAI integration.**
- The key is read only on the server, in a `server-only` module, and is never sent to the client.
- 10s timeout with `maxRetries: 0`, so worst-case latency is bounded and always shorter than the lease.
- The movie title (user input) goes in the `user` message. The system prompt tells the model to treat it strictly as a title, which limits prompt-injection impact. Output is trimmed, checked for non-empty, and length-capped.
- Errors are logged server-side (message only) and the client gets a generic, friendly message. Error internals never leak.

### Security & authorization

- **Identity comes only from the server session.** `GET /api/fact` takes no request input at all (`GET()` has no `Request` parameter), so `?userId=someone-else` is structurally impossible to honor. The onboarding server action likewise ignores any id in the form.
- **Every repository method is keyed by `userId`.** There is no "get fact by id" path that could be abused (no IDOR surface). The API response doesn't include `userId`.
- **Database sessions:** the cookie is an opaque token checked against Postgres on each request, so sessions are revocable and no profile data sits in the cookie. NextAuth handles OAuth `state`/PKCE and CSRF.
- **Route guards live in server components** (`requireUser()`), not only in middleware, so the check runs where the data is read. `/dashboard` and `/onboarding` redirect to `/` (the login page) when signed out.
- **Validation:** Zod on the server trims, collapses whitespace, enforces 1–100 characters, and rejects control characters. Prisma parameterizes all queries, and the single raw query uses tagged-template parameters.
- **Responses:** `Cache-Control: no-store` on per-user API responses.
- **Missing Google data:** a missing name shows "Movie fan". A missing photo, or one that fails to load, falls back to initials (from the name, else the email). A missing email is simply not shown.

### Onboarding correctness

`saveFavoriteMovie` updates with `WHERE id = $session AND favoriteMovie IS NULL`. Onboarding is first-time only even if someone replays the form POST, and the page itself redirects onboarded users to the dashboard.

---

## Why Variant A

When I first sketched the app, the part that worried me most was the OpenAI call. It's the only piece that's slow, costs money, and can fail, and it runs on something as casual as refreshing a page. I wanted that part to be reliable, so I chose to put my time there rather than into polishing the UI.

A few reasons in particular:

- **This is where the subtle bugs are.** Two tabs open at once, or a quick double refresh: it's easy to write code that looks fine and still fires off three OpenAI calls at the same time. I wanted to think those cases through properly and then prove them with tests, including one that runs against a real Postgres database instead of a mock.
- **I like problems with a clear right answer.** "Fresh means under 60 seconds." "One user never sees another user's data." "A burst of requests produces one fact, not five." Each of those can be pinned down in a test, and that's the kind of backend work I enjoy most.
- **The tradeoffs are worth discussing.** A database lease or an in-memory lock? Should a request wait when another one is already generating, or show the previous fact? Those are decisions I can explain and defend, which felt like the point of the exercise.

Variant B is a good problem too, but much of its value is in how the UI feels in the hand. I thought a test showing 20 concurrent requests producing exactly one winner would say more about my engineering in a short take-home.

## Key tradeoffs

| Decision | Alternative | Why |
| --- | --- | --- |
| DB lease row with expiry | In-memory lock | In-memory breaks with more than one server instance or serverless; the lease works anywhere Postgres does |
| Lease held across the OpenAI call (via a row) | Transaction or advisory lock held across the call | Doesn't pin a DB connection for up to 10s per request |
| Losers return the previous fact | Everyone waits for the winner | Faster, simpler; the user already has a fact. Waiting only on the very first fact |
| Poll for the first in-flight fact | LISTEN/NOTIFY or pub/sub | Rare path, bounded (~12s); not worth extra infrastructure |
| `favoriteMovie` column on `User` | `Movie` table + FK | One movie per user; no catalog. Facts snapshot the title, so a future "edit movie" feature still caches correctly |
| Facts kept forever (append-only) | Overwrite a single row | Spec asks to store facts; history is useful and cheap. Cleanup can be added later |
| App clock for timestamps | DB `now()` | Single clock source in the service makes the window logic deterministic and testable. Fine for one region; see improvements |
| NextAuth v4 (stable) | Auth.js v5 (beta) | Stable, well-documented; v5's APIs were still in beta |
| 0 OpenAI retries | SDK default retries | Bounded latency under the lease; the stale fallback covers transient failures |
| Fact fetched client-side after page load | Fetch inside the server component | The dashboard renders instantly and the fact card has its own loading/error states, so a slow OpenAI call never blocks the page |

## With 2 more hours

- **Rate limiting per user** on `/api/fact`. The cache bounds OpenAI spend, but not DB reads from a hostile client.
- **Use DB time (`now()`) for `createdAt` and lease comparisons** to remove any dependence on app-server clock sync across instances.
- **Better first-fact waiting:** replace polling with Postgres `LISTEN/NOTIFY`, or have the client retry using `Retry-After`.
- **Edit favorite movie** on the dashboard. The data model already supports it, because the cache is keyed by movie.
- **E2E test** (Playwright) of the full sign-in → onboarding → dashboard flow using a mocked OAuth provider.
- **Structured logging/metrics** for cache hit rate, OpenAI latency, and fallback rate. Also a retention job for old facts.
- **Show the countdown** until a new fact can be generated, and avoid repeating previous facts by passing recent ones to the prompt.

## AI usage

- Used an AI coding assistant (Claude Code) to help scaffold the project, write boilerplate (NextAuth/Prisma setup, Tailwind markup), and draft tests and this README.
- I directed the design decisions: Variant A, the lease-based concurrency approach, schema shape, and failure semantics. I reviewed the generated code line by line.
- Used it to check current library APIs and version compatibility (e.g. pinning Next 15 / Prisma 6 / NextAuth v4 instead of brand-new majors).
- Verified behavior by running the test suite (including a real-Postgres concurrency test) and an end-to-end smoke test against a seeded session. That smoke test caught a real `timestamp` vs `timestamptz` issue, which I fixed with a migration.

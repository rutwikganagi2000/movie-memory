/** A fact younger than this is served from cache instead of generating a new one. */
export const FACT_CACHE_WINDOW_MS = 60_000;

/** Hard timeout for a single OpenAI call (no retries). */
export const OPENAI_TIMEOUT_MS = 10_000;

/**
 * How long a generation lease is valid. Must comfortably exceed the OpenAI
 * timeout plus the DB write, so a healthy request never loses its lease, while
 * a crashed request only blocks generation for this long.
 */
export const LOCK_LEASE_MS = 30_000;

/** When another request is generating the user's very first fact, poll for it. */
export const WAIT_POLL_INTERVAL_MS = 300;
export const WAIT_MAX_MS = OPENAI_TIMEOUT_MS + 2_000;

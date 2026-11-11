import type { FactErrorCode, FactSource } from "./service";

/** Response contract of GET /api/fact (shared by the route and the client). */
export type FactResponse =
  | { fact: { content: string; movie: string; createdAt: string }; source: FactSource }
  | { error: { code: FactErrorCode | "UNAUTHORIZED"; message: string } };

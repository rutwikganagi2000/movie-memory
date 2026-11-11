import { describe, expect, it } from "vitest";
import { movieTitleSchema } from "@/lib/validation";

describe("movieTitleSchema", () => {
  it("trims and collapses whitespace", () => {
    expect(movieTitleSchema.parse("   The   Matrix  ")).toBe("The Matrix");
  });

  it("accepts single-character titles", () => {
    expect(movieTitleSchema.parse("M")).toBe("M");
  });

  it("rejects empty / whitespace-only input", () => {
    expect(movieTitleSchema.safeParse("").success).toBe(false);
    expect(movieTitleSchema.safeParse("    ").success).toBe(false);
  });

  it("enforces the max length after trimming", () => {
    expect(movieTitleSchema.safeParse("a".repeat(100)).success).toBe(true);
    expect(movieTitleSchema.safeParse(`  ${"a".repeat(100)}  `).success).toBe(true);
    expect(movieTitleSchema.safeParse("a".repeat(101)).success).toBe(false);
  });

  it("rejects control characters and non-strings", () => {
    expect(movieTitleSchema.safeParse("Bad\u0000Title").success).toBe(false);
    expect(movieTitleSchema.safeParse(42).success).toBe(false);
  });
});

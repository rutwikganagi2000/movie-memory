import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => ({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` throws when imported outside a React Server Component
      // bundle; in tests we run server code directly, so stub it out.
      "server-only": fileURLToPath(new URL("./tests/helpers/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Load .env (all keys, not just VITE_*) so TEST_DATABASE_URL is available.
    env: loadEnv(mode, process.cwd(), ""),
  },
}));

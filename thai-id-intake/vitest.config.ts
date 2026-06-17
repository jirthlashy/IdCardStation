import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@thai-id-intake/shared-types": fileURLToPath(new URL("./packages/shared-types/src/index.ts", import.meta.url))
    }
  }
});

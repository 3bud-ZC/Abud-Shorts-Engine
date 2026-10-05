import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/nockIsolation.setup.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/release/**",
      "**/.system_generated/**",
      "**/temp/**",
      "**/data/**",
    ],
  },
});

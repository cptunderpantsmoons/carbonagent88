import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/desktop/src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/release/**",
      "**/.qoder/**",
      "**/.pew/**",
      "**/.agents/**",
      "**/.codex/**",
    ],
    globals: true,
    environment: "node",
  },
});

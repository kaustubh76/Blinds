import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 300_000,
    hookTimeout: 300_000,
    globalSetup: ["./setup.ts"],
    reporters: ["verbose"],
  },
});

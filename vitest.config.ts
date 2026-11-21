import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{core,cli,app}/test/**/*.test.ts"],
  },
});

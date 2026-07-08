import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { convexTestProviderPlugin } from "feather-testing-convex/vitest-plugin";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [convexTestProviderPlugin()],
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/**/*.test.ts"],
          globals: true,
          server: { deps: { inline: ["convex-test", "feather-testing-convex"] } },
        },
      },
      {
        plugins: [react(), convexTestProviderPlugin()],
        test: {
          name: "web",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          globals: true,
          setupFiles: ["./src/test-setup.ts"],
          server: { deps: { inline: ["convex-test", "feather-testing-convex"] } },
        },
      },
    ],
  },
});

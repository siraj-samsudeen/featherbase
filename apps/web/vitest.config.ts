import { defineConfig } from "vitest/config";
import { convexTestProviderPlugin } from "feather-testing-convex/vitest-plugin";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**", "convex/**"],
      exclude: [
        "convex/_generated/**",
        "convex/doctypes.gen.ts",
        "convex/hooks.gen.ts",
        "convex/test.setup.ts",
        "convex/doctype/test.helpers.ts",
        "src/routeTree.gen.ts",
        "src/main.tsx",
        "src/test-setup.ts",
        "**/*.test.*",
        "**/*.d.ts",
      ],
      thresholds: { lines: 100 },
    },
    projects: [
      {
        plugins: [convexTestProviderPlugin()],
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/**/*.test.ts"],
          globals: true,
          server: {
            deps: { inline: ["convex-test", "feather-testing-convex"] },
          },
        },
      },
      {
        plugins: [convexTestProviderPlugin()],
        test: {
          name: "web",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          globals: true,
          setupFiles: ["./src/test-setup.ts"],
          server: {
            deps: { inline: ["convex-test", "feather-testing-convex"] },
          },
        },
      },
    ],
  },
});

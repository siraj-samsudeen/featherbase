import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import vitest from "@vitest/eslint-plugin";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/convex/_generated/**",
      "**/routeTree.gen.ts",
      "**/doctypes.gen.ts",
      "**/hooks.gen.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.tsx"],
    extends: [reactHooks.configs.flat["recommended-latest"]],
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      // `test` comes from createConvexTest's fixtures, not vitest's export.
      "vitest/no-standalone-expect": [
        "error",
        { additionalTestBlockFunctions: ["test"] },
      ],
      // feather-testing-convex fixtures are `any`-typed at the boundary
      // (documented library gap) — unsafe-* rules drown tests in noise.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      // The testing philosophy's bans, made real (feather-testing-study gap #3):
      // snapshots hide intent; toBeDefined()-style assertions assert nothing.
      "vitest/no-restricted-matchers": [
        "error",
        {
          toMatchSnapshot:
            "Snapshots are banned — assert visible behavior instead.",
          toMatchInlineSnapshot:
            "Snapshots are banned — assert visible behavior instead.",
          toThrowErrorMatchingSnapshot:
            "Snapshots are banned — assert the message instead.",
          toBeDefined: "Assert the actual value, not its existence.",
          toBeTruthy: "Assert the actual value, not its truthiness.",
        },
      ],
    },
  },
  {
    // Convex function files and test fixtures legitimately deal in `any`-ish
    // boundaries (fixture clients, glob module maps).
    files: ["**/convex/test.setup.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
);

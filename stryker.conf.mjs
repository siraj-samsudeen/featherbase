// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  appendPlugins: ["@hughescr/stryker-bun-runner"],
  testRunner: "bun",
  coverageAnalysis: "perTest",
  // Stryker rewrites the tsconfig named here through TypeScript's JS API, which TypeScript 7
  // no longer has. Naming a file that does not exist skips the rewrite; it is only needed for
  // tsconfigs that "extend" a relative path, and ours does not.
  tsconfigFile: "no-tsconfig-rewrite.json",
  mutate: ["src/**/*.ts", "!src/**/*.test.ts"],
  // The process folders hold symlinked skills, which Stryker's sandbox copy cannot handle,
  // and nothing in them is code under test.
  ignorePatterns: [".claude", ".agents", ".opencode", "openspec", "adr"],
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
};

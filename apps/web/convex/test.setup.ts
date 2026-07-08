/// <reference types="vite/client" />
import { createConvexTest } from "feather-testing-convex";
import {
  renderWithConvexQuery,
  renderWithConvexQueryAuth,
} from "feather-testing-convex/tanstack-query";
import schema from "./schema";

// Not the README's `./**/!(*.*.*)*.*s` — Vite 6+ (tinyglobby) dropped extglob
// support, which silently matches nothing. Explicit excludes instead.
export const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.d.ts",
  "!./**/*.test.ts",
  "!./test.setup.ts",
]);
export const test = createConvexTest(schema, modules);
export { renderWithConvexQuery, renderWithConvexQueryAuth };

// Shared fixtures for the capability-3/4 matrices: the `book` DocType
// exercising every field type in the generated UI, router-rendering helpers
// (auth-aware since capability 4's shell gate), and the chunked seeding used
// by the realistic-count guard (G15).
import { useCallback, useMemo } from "react";
import { render } from "@testing-library/react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { getFunctionName } from "convex/server";
import type { FunctionReference } from "convex/server";
import { routeTree } from "./routeTree.gen";
import { renderWithConvexQueryAuth } from "../convex/test.setup";
import { api } from "../convex/_generated/api";
import type { MutationCtx } from "../convex/_generated/server";
import { asDynamicDb, createRecord } from "../convex/doctype/repository";
import type { StoredDoctype } from "../convex/doctype/repository";
import { toStored } from "../convex/doctypes";
import type { DocTypeDefinition } from "../convex/doctype/definition";

export const bookDefinition: DocTypeDefinition = {
  name: "book",
  label: "Book",
  fields: [
    {
      name: "title",
      label: "Title",
      type: "text",
      required: true,
      filterable: true,
    },
    { name: "pages", label: "Pages", type: "number", filterable: true },
    { name: "signed", label: "Signed", type: "boolean", filterable: true },
    {
      name: "genre",
      label: "Genre",
      type: "select",
      filterable: true,
      options: ["fiction", "science"],
    },
    { name: "remarks", type: "text" },
  ],
};

export const storedBook: StoredDoctype = { ...bookDefinition, source: "site" };

export interface BookRow {
  title: string;
  pages?: number;
  signed?: boolean;
  genre?: string;
  remarks?: string;
}

// The narrow view of the `client` fixture the helpers need (the fixture
// itself is any-typed at the library boundary).
export interface TestBackend {
  mutation: (fn: unknown, args: unknown) => Promise<unknown>;
  query: (fn: unknown, args: unknown) => Promise<unknown>;
}

export interface TestRunner {
  run: (fn: (ctx: MutationCtx) => Promise<void>) => Promise<void>;
}

export function renderApp(
  client: unknown,
  path: string,
  options?: { authenticated?: boolean; signInError?: Error },
) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return renderWithConvexQueryAuth(
    <RouterProvider router={router} />,
    client,
    options,
  );
}

export async function createBookDoctype(client: TestBackend): Promise<void> {
  await client.mutation(api.doctypes.create, { definition: bookDefinition });
}

export async function seedBooks(
  client: TestBackend,
  rows: BookRow[],
): Promise<string[]> {
  await createBookDoctype(client);
  const ids: string[] = [];
  for (const row of rows) {
    ids.push(
      (await client.mutation(api.records.create, {
        doctype: "book",
        data: row,
      })) as string,
    );
  }
  return ids;
}

// G15's seeding: through the repository seam (the exact code path mutations
// use) in chunked transactions, same technique as capability 2's F11. Each
// chunk writes 100 records × (1 doc + ≤4 sidecar rows) — far under caps.
export async function seedManyBooks(
  testClient: TestRunner,
  count: number,
): Promise<void> {
  const chunkSize = 100;
  for (let start = 0; start < count; start += chunkSize) {
    await testClient.run(async (ctx: MutationCtx) => {
      const row = await ctx.db
        .query("doctypes")
        .withIndex("by_name", (q) => q.eq("name", "book"))
        .unique();
      if (row === null) throw new Error("book doctype missing");
      const stored = toStored(row);
      const end = Math.min(start + chunkSize, count);
      for (let i = start; i < end; i++) {
        await createRecord(
          asDynamicDb(ctx.db),
          stored,
          {
            title: `b${String(i).padStart(3, "0")}`,
            pages: i,
            genre: i % 2 === 0 ? "fiction" : "science",
          },
          "seed-user",
        );
      }
    });
  }
}

// Loading and forced-failure states are unreachable with the real in-memory
// backend (the only mocked matrix rows). A fake backend object stands in for
// the convex-test client behind the same auth-aware provider stack every
// other test uses, so the capability-4 shell gate still renders the routes:
// named functions resolve from `resolved`, everything else pends or rejects.
function renderWithFakeBackend(
  path: string,
  resolved: Record<string, unknown>,
  fallback: (name: string) => Promise<unknown>,
) {
  const query = (fn: unknown) => {
    const name = getFunctionName(fn as FunctionReference<"query">);
    if (name in resolved) return Promise.resolve(resolved[name]);
    return fallback(name);
  };
  const fake = { query, mutation: query, action: query };
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return renderWithConvexQueryAuth(<RouterProvider router={router} />, fake);
}

export function renderPending(
  path: string,
  resolved: Record<string, unknown> = {},
) {
  return renderWithFakeBackend(
    path,
    resolved,
    () => new Promise(() => undefined),
  );
}

export function renderFailing(
  path: string,
  resolved: Record<string, unknown> = {},
) {
  return renderWithFakeBackend(path, resolved, (name) =>
    Promise.reject(new Error(`${name} failed`)),
  );
}

// The auth-pending shell state (matrix A5): the fixture provider hardcodes
// isLoading: false, so this one state renders through the real
// ConvexProviderWithAuth with a useAuth that never finishes loading. No
// query providers needed — the shell mounts nothing behind the gate.
function useAuthPending() {
  const fetchAccessToken = useCallback(() => Promise.resolve(null), []);
  return useMemo(
    () => ({ isLoading: true, isAuthenticated: false, fetchAccessToken }),
    [fetchAccessToken],
  );
}

export function renderAuthLoading(path: string) {
  const convex = new ConvexReactClient("https://test.convex.cloud");
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(
    <ConvexProviderWithAuth client={convex} useAuth={useAuthPending}>
      <RouterProvider router={router} />
    </ConvexProviderWithAuth>,
  );
}

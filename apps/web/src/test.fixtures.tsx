// Shared fixtures for the capability-3 matrix: the `book` DocType exercising
// every field type in the generated UI, router-rendering helpers, and the
// chunked seeding used by the realistic-count guard (G15).
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProvider, ConvexReactClient } from "convex/react";
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

export function renderApp(client: unknown, path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return renderWithConvexQueryAuth(<RouterProvider router={router} />, client);
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

// Loading states are unreachable with the real in-memory backend (the only
// mocked matrix rows): query fns that never resolve, optionally resolving
// named functions first to pin the second guard of two-query components.
export function renderPending(
  path: string,
  resolved: Record<string, unknown> = {},
) {
  const convex = new ConvexReactClient("https://test.convex.cloud");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: ({ queryKey }) => {
          const name = getFunctionName(
            queryKey[1] as FunctionReference<"query">,
          );
          if (name in resolved) return Promise.resolve(resolved[name]);
          return new Promise(() => undefined);
        },
      },
    },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(
    <ConvexProvider client={convex}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ConvexProvider>,
  );
}

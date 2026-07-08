import { expect } from "vitest";
import { test } from "./test.setup";
import { api } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { asDynamicDb, createRecord } from "./doctype/repository";
import { toStored } from "./doctypes";
import { productDefinition } from "./doctype/test.helpers";

// Matrix rows F1–F11 (docs/capabilities/2-doctype-engine/2_spec.md) —
// filter/sort on user-defined fields through the fieldIndex sidecar.

type ProductRow = {
  title: string;
  price?: number;
  category?: string;
};

async function seedProducts(
  client: { mutation: (fn: unknown, args: unknown) => Promise<unknown> },
  rows: ProductRow[],
): Promise<string[]> {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });
  const ids: string[] = [];
  for (const row of rows) {
    ids.push(
      (await client.mutation(api.records.create, {
        doctype: "product",
        data: row,
      })) as string,
    );
  }
  return ids;
}

test("filters by a text field value", async ({ client }) => {
  await seedProducts(client, [
    { title: "Widget", category: "gadget" },
    { title: "Hammer", category: "tool" },
    { title: "Gizmo", category: "gadget" },
  ]);

  const docs = await client.query(api.records.list, {
    doctype: "product",
    filter: { field: "category", value: "gadget" },
  });
  const titles = docs.map((doc: { title: string }) => doc.title).sort();
  expect(titles).toEqual(["Gizmo", "Widget"]);
});

test("filters by a number field value", async ({ client }) => {
  await seedProducts(client, [
    { title: "A", price: 10 },
    { title: "B", price: 20 },
    { title: "C", price: 10 },
  ]);

  const docs = await client.query(api.records.list, {
    doctype: "product",
    filter: { field: "price", value: 10 },
  });
  expect(docs).toHaveLength(2);
});

test("rejects filtering an unknown field", async ({ client }) => {
  await seedProducts(client, [{ title: "A" }]);

  await expect(
    client.query(api.records.list, {
      doctype: "product",
      filter: { field: "bogus", value: 1 },
    }),
  ).rejects.toThrow('unknown field "bogus"');
});

test("rejects filtering a non-filterable field", async ({ client }) => {
  await seedProducts(client, [{ title: "A" }]);

  await expect(
    client.query(api.records.list, {
      doctype: "product",
      filter: { field: "notes", value: "x" },
    }),
  ).rejects.toThrow('field "notes" is not filterable');
});

test("sorts ascending by a number field", async ({ client }) => {
  await seedProducts(client, [
    { title: "A", price: 30 },
    { title: "B", price: 10 },
    { title: "C", price: 20 },
  ]);

  const docs = await client.query(api.records.list, {
    doctype: "product",
    sort: { field: "price", direction: "asc" },
  });
  expect(docs.map((doc: { price: number }) => doc.price)).toEqual([10, 20, 30]);
});

test("sorts descending by a number field", async ({ client }) => {
  await seedProducts(client, [
    { title: "A", price: 30 },
    { title: "B", price: 10 },
    { title: "C", price: 20 },
  ]);

  const docs = await client.query(api.records.list, {
    doctype: "product",
    sort: { field: "price", direction: "desc" },
  });
  expect(docs.map((doc: { price: number }) => doc.price)).toEqual([30, 20, 10]);
});

test("combines filter and sort", async ({ client }) => {
  await seedProducts(client, [
    { title: "A", price: 10, category: "gadget" },
    { title: "B", price: 30, category: "gadget" },
    { title: "C", price: 20, category: "tool" },
    { title: "D", price: 20, category: "gadget" },
  ]);

  const docs = await client.query(api.records.list, {
    doctype: "product",
    filter: { field: "category", value: "gadget" },
    sort: { field: "price", direction: "desc" },
  });
  expect(docs.map((doc: { price: number }) => doc.price)).toEqual([30, 20, 10]);
});

test("reflects updates in filter results", async ({ client }) => {
  const [id] = await seedProducts(client, [
    { title: "Widget", category: "gadget" },
  ]);

  await client.mutation(api.records.update, {
    doctype: "product",
    id,
    data: { category: "tool" },
  });

  const tools = await client.query(api.records.list, {
    doctype: "product",
    filter: { field: "category", value: "tool" },
  });
  const gadgets = await client.query(api.records.list, {
    doctype: "product",
    filter: { field: "category", value: "gadget" },
  });
  expect(tools).toHaveLength(1);
  expect(gadgets).toHaveLength(0);
});

test("removes deleted records from filter results", async ({
  client,
  testClient,
}) => {
  const [first] = await seedProducts(client, [
    { title: "Widget", category: "gadget" },
    { title: "Gizmo", category: "gadget" },
  ]);
  if (first === undefined) throw new Error("seed returned no ids");

  await client.mutation(api.records.remove, {
    doctype: "product",
    id: first,
  });

  const docs = await client.query(api.records.list, {
    doctype: "product",
    filter: { field: "category", value: "gadget" },
  });
  expect(docs).toHaveLength(1);
  expect(docs[0]?.title).toBe("Gizmo");
  const sidecarRows = await testClient.run(async (ctx: MutationCtx) => {
    return await ctx.db
      .query("fieldIndex")
      .withIndex("by_doctype_docId", (q) =>
        q.eq("doctype", "product").eq("docId", first),
      )
      .collect();
  });
  expect(sidecarRows).toHaveLength(0);
});

test("omits records missing the queried field", async ({ client }) => {
  await seedProducts(client, [
    { title: "Priced", price: 10 },
    { title: "Unpriced" },
  ]);

  const filtered = await client.query(api.records.list, {
    doctype: "product",
    filter: { field: "price", value: 10 },
  });
  const sorted = await client.query(api.records.list, {
    doctype: "product",
    sort: { field: "price", direction: "asc" },
  });
  expect(filtered).toHaveLength(1);
  expect(filtered[0]?.title).toBe("Priced");
  expect(sorted).toHaveLength(1);
  expect(sorted[0]?.title).toBe("Priced");
});

test("filters and sorts a thousand records", async ({ client, testClient }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });
  // Seeded through the repository seam itself (the exact code path the
  // mutations use), chunked to stay far under per-transaction write caps.
  for (let chunk = 0; chunk < 4; chunk++) {
    await testClient.run(async (ctx: MutationCtx) => {
      const row = await ctx.db
        .query("doctypes")
        .withIndex("by_name", (q) => q.eq("name", "product"))
        .unique();
      if (row === null) throw new Error("product doctype missing");
      const stored = toStored(row);
      for (let i = 0; i < 250; i++) {
        const n = chunk * 250 + i;
        await createRecord(
          asDynamicDb(ctx.db),
          stored,
          {
            title: `p${n}`,
            price: n % 50,
            category: n % 2 === 0 ? "gadget" : "tool",
          },
          "seed-user",
        );
      }
    });
  }

  const filtered = await client.query(api.records.list, {
    doctype: "product",
    filter: { field: "price", value: 7 },
  });
  expect(filtered).toHaveLength(20);
  expect(filtered.every((doc: { price: number }) => doc.price === 7)).toBe(
    true,
  );

  const sorted = await client.query(api.records.list, {
    doctype: "product",
    sort: { field: "price", direction: "asc" },
  });
  expect(sorted).toHaveLength(1000);
  const prices = sorted.map((doc: { price: number }) => doc.price);
  for (let i = 1; i < prices.length; i++) {
    expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1] ?? 0);
  }
});

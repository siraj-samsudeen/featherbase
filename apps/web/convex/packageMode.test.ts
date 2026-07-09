import { expect } from "vitest";
import fc from "fast-check";
import { test } from "./test.setup";
import { api } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import doctypesGenSource from "./doctypes.gen.ts?raw";
import hooksGenSource from "./hooks.gen.ts?raw";
import invoiceJson from "../doctypes/invoice.json";
import materializations from "../doctypes/materializations.json";
import {
  generateDoctypesModule,
  generateHookStub,
  generateHooksModule,
} from "./doctype/codegen";
import { parseDefinition, validateDefinition } from "./doctype/definition";
import { definitionArb, sampleData } from "./doctype/test.helpers";

// Matrix rows G1–G6, L4 (docs/capabilities/2-doctype-engine/2_spec.md)

test("keeps generated artifacts deterministic and in sync", () => {
  const invoice = validateDefinition(invoiceJson);
  const first = generateDoctypesModule([invoice], materializations);
  const second = generateDoctypesModule([invoice], materializations);
  expect(second).toBe(first);
  expect(first).toBe(doctypesGenSource);
  expect(generateHooksModule([invoice])).toBe(hooksGenSource);
  // Deterministic includes input-order independence: definitions are emitted
  // in canonical (name-sorted) order no matter how they're passed in.
  const aardvark = validateDefinition({
    name: "aardvark",
    fields: [{ name: "x", type: "text" }],
  });
  expect(generateDoctypesModule([aardvark, invoice], materializations)).toBe(
    generateDoctypesModule([invoice, aardvark], materializations),
  );
  expect(generateHooksModule([aardvark, invoice])).toBe(
    generateHooksModule([invoice, aardvark]),
  );
  const stub = generateHookStub(invoice);
  expect(stub).toContain('import type { Invoice } from "../doctypes.gen"');
  expect(stub).toContain("export function validate(_data: Invoice): void");
  expect(stub).toContain("export function beforeSave(data: Invoice): Invoice");
});

test("stores package records in the typed table", async ({
  client,
  testClient,
  userId,
}) => {
  await client.mutation(api.doctypes.sync, {});

  const id = await client.mutation(api.records.create, {
    doctype: "invoice",
    data: { customer: "Acme", amount: 100, status: "draft" },
  });

  const doc = await client.query(api.records.get, { doctype: "invoice", id });
  expect(doc?.customer).toBe("Acme");
  expect(doc?.amount).toBe(100);
  expect(doc?.owner).toBe(userId);
  expect(doc?.docstatus).toBe(0);
  // The record passed dt_invoice's generated validator (schema-enforced).
  const rows = await testClient.run(async (ctx: MutationCtx) => {
    return await ctx.db.query("dt_invoice").collect();
  });
  expect(rows).toHaveLength(1);
});

test("filters a package doctype via native index", async ({
  client,
  testClient,
}) => {
  await client.mutation(api.doctypes.sync, {});
  for (const [customer, status] of [
    ["Acme", "paid"],
    ["Globex", "draft"],
    ["Initech", "paid"],
  ]) {
    await client.mutation(api.records.create, {
      doctype: "invoice",
      data: { customer, amount: 10, status },
    });
  }

  const paid = await client.query(api.records.list, {
    doctype: "invoice",
    filter: { field: "status", value: "paid" },
  });
  expect(paid).toHaveLength(2);
  // Native path proof: nothing was ever written to the sidecar.
  const sidecarRows = await testClient.run(async (ctx: MutationCtx) => {
    return await ctx.db
      .query("fieldIndex")
      .withIndex("by_doctype_docId", (q) => q.eq("doctype", "invoice"))
      .collect();
  });
  expect(sidecarRows).toHaveLength(0);
});

test("sorts a package doctype via native index", async ({ client }) => {
  await client.mutation(api.doctypes.sync, {});
  for (const amount of [50, 150, 100]) {
    await client.mutation(api.records.create, {
      doctype: "invoice",
      data: { customer: "Acme", amount },
    });
  }

  const docs = await client.query(api.records.list, {
    doctype: "invoice",
    sort: { field: "amount", direction: "desc" },
  });
  expect(docs.map((doc: { amount: number }) => doc.amount)).toEqual([
    150, 100, 50,
  ]);
});

test("validate hook rejects an invalid record", async ({ client }) => {
  await client.mutation(api.doctypes.sync, {});

  await expect(
    client.mutation(api.records.create, {
      doctype: "invoice",
      data: { customer: "Acme", amount: -5 },
    }),
  ).rejects.toThrow("amount must be positive");
});

test("beforeSave hook normalizes data", async ({ client }) => {
  await client.mutation(api.doctypes.sync, {});

  const id = await client.mutation(api.records.create, {
    doctype: "invoice",
    data: { customer: "  Acme  ", amount: 10 },
  });

  const doc = await client.query(api.records.get, { doctype: "invoice", id });
  expect(doc?.customer).toBe("Acme");
});

test("round-trips promoted definitions and records", async ({ client }) => {
  const samples = fc.sample(definitionArb, { numRuns: 25, seed: 42 });
  for (const [index, sampled] of samples.entries()) {
    const definition = { ...sampled, name: `${sampled.name}_rt${index}` };
    await client.mutation(api.doctypes.create, { definition });
    const data = sampleData(definition);
    const id = await client.mutation(api.records.create, {
      doctype: definition.name,
      data,
    });

    const json = await client.mutation(api.doctypes.promote, {
      name: definition.name,
    });
    expect(parseDefinition(json)).toEqual(definition);
    await client.mutation(api.doctypes.demote, { name: definition.name });

    const stored = await client.query(api.doctypes.get, {
      name: definition.name,
    });
    expect(stored).toEqual({ ...definition, source: "site" });
    const record = await client.query(api.records.get, {
      doctype: definition.name,
      id,
    });
    expect(record).toMatchObject(data);
  }
});

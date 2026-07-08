import { expect } from "vitest";
import { test } from "./test.setup";
import { api } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { parseDefinition } from "./doctype/definition";
import { customerDefinition, productDefinition } from "./doctype/test.helpers";

// Matrix rows D1–D16, U1, L1, L2, L5–L7
// (docs/capabilities/2-doctype-engine/2_spec.md)

test("stores a site doctype", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });

  const stored = await client.query(api.doctypes.get, { name: "product" });
  expect(stored).toEqual({ ...productDefinition, source: "site" });
});

test("lists created doctypes", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });
  await client.mutation(api.doctypes.create, {
    definition: customerDefinition,
  });

  const doctypes = await client.query(api.doctypes.list, {});
  const names = doctypes.map((doctype: { name: string }) => doctype.name);
  expect(names).toContain("product");
  expect(names).toContain("customer");
});

test("returns null for an unknown doctype", async ({ client }) => {
  const stored = await client.query(api.doctypes.get, { name: "ghost" });
  expect(stored).toBeNull();
});

test("rejects a duplicate doctype name", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });

  await expect(
    client.mutation(api.doctypes.create, { definition: productDefinition }),
  ).rejects.toThrow('doctype "product" already exists');
});

test("rejects a malformed doctype name", async ({ client }) => {
  await expect(
    client.mutation(api.doctypes.create, {
      definition: { ...productDefinition, name: "Bad Name" },
    }),
  ).rejects.toThrow("doctype name must match");
});

test("rejects a definition without fields", async ({ client }) => {
  await expect(
    client.mutation(api.doctypes.create, {
      definition: { name: "empty", fields: [] },
    }),
  ).rejects.toThrow("fields must be a non-empty array");
});

test("rejects duplicate field names", async ({ client }) => {
  await expect(
    client.mutation(api.doctypes.create, {
      definition: {
        name: "dupe",
        fields: [
          { name: "title", type: "text" },
          { name: "title", type: "number" },
        ],
      },
    }),
  ).rejects.toThrow('duplicate field name "title"');
});

test("rejects a reserved field name", async ({ client }) => {
  await expect(
    client.mutation(api.doctypes.create, {
      definition: { name: "sneaky", fields: [{ name: "owner", type: "text" }] },
    }),
  ).rejects.toThrow('field name "owner" is reserved');
});

test("rejects a malformed field name", async ({ client }) => {
  await expect(
    client.mutation(api.doctypes.create, {
      definition: {
        name: "spacey",
        fields: [{ name: "First Name", type: "text" }],
      },
    }),
  ).rejects.toThrow("field name must match");
});

test("rejects an unknown field type", async ({ client }) => {
  await expect(
    client.mutation(api.doctypes.create, {
      definition: { name: "dated", fields: [{ name: "due", type: "date" }] },
    }),
  ).rejects.toThrow('unknown field type "date"');
});

test("rejects a select field without options", async ({ client }) => {
  await expect(
    client.mutation(api.doctypes.create, {
      definition: {
        name: "optionless",
        fields: [{ name: "status", type: "select" }],
      },
    }),
  ).rejects.toThrow("select fields require a non-empty array");
});

test("rejects options on a non-select field", async ({ client }) => {
  await expect(
    client.mutation(api.doctypes.create, {
      definition: {
        name: "confused",
        fields: [{ name: "title", type: "text", options: ["a"] }],
      },
    }),
  ).rejects.toThrow("options are only allowed on select fields");
});

test("rejects a non-object definition", async ({ client }) => {
  await expect(
    client.mutation(api.doctypes.create, { definition: "nope" }),
  ).rejects.toThrow("definition must be an object");
});

test("rejects a wrong-typed field property", async ({ client }) => {
  await expect(
    client.mutation(api.doctypes.create, {
      definition: {
        name: "typed",
        fields: [{ name: "title", type: "text", required: "yes" }],
      },
    }),
  ).rejects.toThrow("required must be a boolean");
});

test("syncs package definitions idempotently", async ({ client }) => {
  await client.mutation(api.doctypes.sync, {});
  await client.mutation(api.doctypes.sync, {});

  const doctypes = await client.query(api.doctypes.list, {});
  const invoices = doctypes.filter(
    (doctype: { name: string }) => doctype.name === "invoice",
  );
  expect(invoices).toHaveLength(1);
  expect(invoices[0]?.source).toBe("package");
  expect(invoices[0]?.fields).toHaveLength(5);
});

test("rejects an unknown definition key", async ({ client }) => {
  await expect(
    client.mutation(api.doctypes.create, {
      definition: { ...productDefinition, extra: 1 },
    }),
  ).rejects.toThrow('unknown definition key "extra"');
});

test("rejects unauthenticated doctype create", async ({ testClient }) => {
  await expect(
    testClient.mutation(api.doctypes.create, {
      definition: productDefinition,
    }),
  ).rejects.toThrow("Not authenticated");
});

test("promotes a doctype without moving data", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });
  const firstId = await client.mutation(api.records.create, {
    doctype: "product",
    data: { title: "Widget", price: 10, category: "gadget" },
  });
  const secondId = await client.mutation(api.records.create, {
    doctype: "product",
    data: { title: "Hammer", price: 20, category: "tool" },
  });

  const json = await client.mutation(api.doctypes.promote, {
    name: "product",
  });
  expect(parseDefinition(json)).toEqual(productDefinition);

  const stored = await client.query(api.doctypes.get, { name: "product" });
  expect(stored?.source).toBe("package");

  const first = await client.query(api.records.get, {
    doctype: "product",
    id: firstId,
  });
  const second = await client.query(api.records.get, {
    doctype: "product",
    id: secondId,
  });
  expect(first?.title).toBe("Widget");
  expect(second?.title).toBe("Hammer");
});

test("demotes a doctype back to site source", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });
  const id = await client.mutation(api.records.create, {
    doctype: "product",
    data: { title: "Widget", price: 10, category: "gadget" },
  });
  await client.mutation(api.doctypes.promote, { name: "product" });

  await client.mutation(api.doctypes.demote, { name: "product" });

  const stored = await client.query(api.doctypes.get, { name: "product" });
  expect(stored).toEqual({ ...productDefinition, source: "site" });
  const filtered = await client.query(api.records.list, {
    doctype: "product",
    filter: { field: "category", value: "gadget" },
  });
  expect(filtered).toHaveLength(1);
  expect(filtered[0]?._id).toBe(id);
});

test("materialize drops sidecar rows and keeps filters", async ({
  client,
  testClient,
}) => {
  await client.mutation(api.doctypes.create, {
    definition: customerDefinition,
  });
  const id = await client.mutation(api.records.create, {
    doctype: "customer",
    data: { email: "a@acme.test", company: "Acme" },
  });
  // Stale sidecar rows, as a pre-materialization deploy would have left them.
  await testClient.run(async (ctx: MutationCtx) => {
    await ctx.db.insert("fieldIndex", {
      doctype: "customer",
      field: "email",
      value: "a@acme.test",
      docId: id,
    });
  });

  await client.mutation(api.doctypes.materialize, { name: "customer" });

  const rows = await testClient.run(async (ctx: MutationCtx) => {
    return await ctx.db
      .query("fieldIndex")
      .withIndex("by_doctype_docId", (q) => q.eq("doctype", "customer"))
      .collect();
  });
  expect(rows).toHaveLength(0);
  const filtered = await client.query(api.records.list, {
    doctype: "customer",
    filter: { field: "email", value: "a@acme.test" },
  });
  expect(filtered).toHaveLength(1);
  expect(filtered[0]?._id).toBe(id);
});

test("rejects materializing without deployed indexes", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });

  await expect(
    client.mutation(api.doctypes.materialize, { name: "product" }),
  ).rejects.toThrow("no deployed native indexes");
});

test("rebuildSidecar restores sidecar rows", async ({ client, testClient }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });
  await client.mutation(api.records.create, {
    doctype: "product",
    data: { title: "Widget", price: 10, category: "gadget" },
  });
  // Simulate the state after a de-materializing deploy: sidecar rows gone.
  await testClient.run(async (ctx: MutationCtx) => {
    const rows = await ctx.db
      .query("fieldIndex")
      .withIndex("by_doctype_docId", (q) => q.eq("doctype", "product"))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  });
  const before = await client.query(api.records.list, {
    doctype: "product",
    filter: { field: "category", value: "gadget" },
  });
  expect(before).toHaveLength(0);

  await client.mutation(api.doctypes.rebuildSidecar, { name: "product" });

  const after = await client.query(api.records.list, {
    doctype: "product",
    filter: { field: "category", value: "gadget" },
  });
  expect(after).toHaveLength(1);
  expect(after[0]?.title).toBe("Widget");
});

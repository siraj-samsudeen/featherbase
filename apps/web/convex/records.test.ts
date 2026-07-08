import { expect } from "vitest";
import { test } from "./test.setup";
import { api } from "./_generated/api";
import { customerDefinition, productDefinition } from "./doctype/test.helpers";

// Matrix rows R1–R11, U2 (docs/capabilities/2-doctype-engine/2_spec.md)

const widget = { title: "Widget", price: 10, category: "gadget" };

test("stores a record with system fields", async ({ client, userId }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });

  const id = await client.mutation(api.records.create, {
    doctype: "product",
    data: { ...widget, active: true },
  });

  const doc = await client.query(api.records.get, {
    doctype: "product",
    id,
  });
  expect(doc?.title).toBe("Widget");
  expect(doc?.price).toBe(10);
  expect(doc?.category).toBe("gadget");
  expect(doc?.active).toBe(true);
  expect(doc?.owner).toBe(userId);
  expect(typeof doc?.creation).toBe("number");
  expect(doc?.modified).toBe(doc?.creation);
  expect(doc?.docstatus).toBe(0);
});

test("returns null for an unknown record id", async ({ client, userId }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });

  // A valid Convex id — from the users table, not this doctype's table.
  const doc = await client.query(api.records.get, {
    doctype: "product",
    id: userId,
  });
  expect(doc).toBeNull();
});

test("patches fields and bumps modified", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });
  const id = await client.mutation(api.records.create, {
    doctype: "product",
    data: widget,
  });

  await client.mutation(api.records.update, {
    doctype: "product",
    id,
    data: { price: 25 },
  });

  const doc = await client.query(api.records.get, { doctype: "product", id });
  expect(doc?.price).toBe(25);
  expect(doc?.title).toBe("Widget");
  expect(doc?.modified as number).toBeGreaterThanOrEqual(
    doc?.creation as number,
  );
});

test("removes a record", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });
  const id = await client.mutation(api.records.create, {
    doctype: "product",
    data: widget,
  });

  await client.mutation(api.records.remove, { doctype: "product", id });

  const doc = await client.query(api.records.get, { doctype: "product", id });
  expect(doc).toBeNull();
});

test("rejects an unknown doctype", async ({ client }) => {
  await expect(
    client.mutation(api.records.create, {
      doctype: "ghost",
      data: { title: "?" },
    }),
  ).rejects.toThrow('unknown doctype "ghost"');
});

test("rejects an unknown field", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });

  await expect(
    client.mutation(api.records.create, {
      doctype: "product",
      data: { ...widget, bogus: 1 },
    }),
  ).rejects.toThrow('unknown field "bogus"');
});

test("rejects a missing required field", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });

  await expect(
    client.mutation(api.records.create, {
      doctype: "product",
      data: { price: 10 },
    }),
  ).rejects.toThrow('missing required field "title"');
});

test("rejects a wrong value type", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });

  await expect(
    client.mutation(api.records.create, {
      doctype: "product",
      data: { title: "Widget", price: "cheap" },
    }),
  ).rejects.toThrow('field "price" must be a number');
});

test("rejects a select value outside options", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });

  await expect(
    client.mutation(api.records.create, {
      doctype: "product",
      data: { title: "Widget", category: "food" },
    }),
  ).rejects.toThrow('field "category" must be one of: gadget, tool');
});

test("lists only the doctype's own records", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });
  await client.mutation(api.doctypes.create, {
    definition: customerDefinition,
  });
  for (const title of ["A", "B", "C"]) {
    await client.mutation(api.records.create, {
      doctype: "product",
      data: { title },
    });
  }
  await client.mutation(api.records.create, {
    doctype: "customer",
    data: { email: "a@acme.test" },
  });

  const products = await client.query(api.records.list, {
    doctype: "product",
  });
  expect(products).toHaveLength(3);
});

test("rejects updating an unknown record id", async ({ client }) => {
  await client.mutation(api.doctypes.create, {
    definition: productDefinition,
  });

  await expect(
    client.mutation(api.records.update, {
      doctype: "product",
      id: "garbage",
      data: { price: 1 },
    }),
  ).rejects.toThrow("record not found");
});

test("rejects unauthenticated record list", async ({ testClient }) => {
  await expect(
    testClient.query(api.records.list, { doctype: "product" }),
  ).rejects.toThrow("Not authenticated");
});

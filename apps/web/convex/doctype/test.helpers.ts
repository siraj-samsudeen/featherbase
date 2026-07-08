// Shared fixtures for the capability-2 matrix: the site DocTypes the tests
// create at runtime, and the fast-check arbitrary for L3/L4 (generates
// definitions already in canonical/normalized form).
import fc from "fast-check";
import { RESERVED_FIELD_NAMES, type DocTypeDefinition } from "./definition";

export const productDefinition: DocTypeDefinition = {
  name: "product",
  label: "Product",
  fields: [
    { name: "title", type: "text", required: true, filterable: true },
    { name: "price", type: "number", filterable: true },
    { name: "active", type: "boolean" },
    {
      name: "category",
      type: "select",
      filterable: true,
      options: ["gadget", "tool"],
    },
    { name: "notes", type: "text" },
  ],
};

// Matches the doctypes/materializations.json entry: email has an enabled
// native index (dt_customer in the generated schema); company's index is
// staged (ADR 0004 amendment) so it stays on the sidecar path.
export const customerDefinition: DocTypeDefinition = {
  name: "customer",
  fields: [
    { name: "email", type: "text", required: true, filterable: true },
    { name: "company", type: "text", filterable: true },
  ],
};

const nameArb = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,9}$/)
  .filter(
    (name) => !(RESERVED_FIELD_NAMES as readonly string[]).includes(name),
  );

const fieldArb = fc
  .record(
    {
      name: nameArb,
      label: fc.string(),
      type: fc.constantFrom("text", "number", "boolean", "select" as const),
      required: fc.constant(true),
      filterable: fc.constant(true),
    },
    { requiredKeys: ["name", "type"] },
  )
  .chain((field) =>
    field.type === "select"
      ? fc
          .uniqueArray(fc.string({ minLength: 1 }), {
            minLength: 1,
            maxLength: 4,
          })
          .map((options) => ({ ...field, options }))
      : fc.constant(field),
  );

export const definitionArb = fc.record(
  {
    name: nameArb,
    label: fc.string(),
    fields: fc.uniqueArray(fieldArb, {
      minLength: 1,
      maxLength: 6,
      selector: (field) => field.name,
    }),
  },
  { requiredKeys: ["name", "fields"] },
) as fc.Arbitrary<DocTypeDefinition>;

// Deterministic representative record data for an arbitrary definition.
export function sampleData(
  definition: DocTypeDefinition,
): Record<string, string | number | boolean> {
  const data: Record<string, string | number | boolean> = {};
  for (const field of definition.fields) {
    data[field.name] =
      field.type === "number"
        ? 1
        : field.type === "boolean"
          ? true
          : field.type === "select"
            ? (field.options?.[0] ?? "")
            : "x";
  }
  return data;
}

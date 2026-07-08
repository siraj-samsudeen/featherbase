import { expect, test } from "vitest";
import fc from "fast-check";
import { parseDefinition, serializeDefinition } from "./definition";
import { definitionArb } from "./test.helpers";

// Matrix row L3 (docs/capabilities/2-doctype-engine/2_spec.md): canonical
// serialization is a fixpoint — the promotion round-trip's pure core.

test("round-trips serialization byte-identically", () => {
  fc.assert(
    fc.property(definitionArb, (definition) => {
      const canonical = serializeDefinition(definition);
      expect(serializeDefinition(parseDefinition(canonical))).toBe(canonical);
    }),
  );
});

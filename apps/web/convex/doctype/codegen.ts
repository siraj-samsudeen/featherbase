// Package-mode codegen (ADR 0003 §3, ADR 0004): pure, deterministic string
// generators. The thin fs wrapper lives in scripts/codegen-doctypes.ts; input
// validation (parse errors, filename/registry conflicts) happens there so
// these functions stay total.
import {
  serializeDefinition,
  type DocTypeDefinition,
  type FieldDefinition,
} from "./definition";

export const RECORD_TABLE_PREFIX = "dt_";

// materializations.json entry: a plain field name gets an enabled native
// index; `{ field, staged: true }` gets a Convex staged index (ADR 0004
// amendment) — backfills without blocking the deploy, and stays OUT of
// nativeIndexes so the repository keeps the sidecar path until a follow-up
// regen/deploy drops the flag.
export type MaterializationEntry = string | { field: string; staged?: boolean };

export function recordTable(doctype: string): string {
  return `${RECORD_TABLE_PREFIX}${doctype}`;
}

function pascalCase(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function fieldValidator(field: FieldDefinition): string {
  const base =
    field.type === "number"
      ? "v.number()"
      : field.type === "boolean"
        ? "v.boolean()"
        : field.type === "select"
          ? `v.union(${(field.options ?? [])
              .map((option) => `v.literal(${JSON.stringify(option)})`)
              .join(", ")})`
          : "v.string()";
  return field.required ? base : `v.optional(${base})`;
}

function fieldTsType(field: FieldDefinition): string {
  const base =
    field.type === "number"
      ? "number"
      : field.type === "boolean"
        ? "boolean"
        : field.type === "select"
          ? (field.options ?? [])
              .map((option) => JSON.stringify(option))
              .join(" | ")
          : "string";
  return `  ${field.name}${field.required ? "" : "?"}: ${base};`;
}

function filterableFields(definition: DocTypeDefinition): string[] {
  return definition.fields
    .filter((field) => field.filterable)
    .map((field) => field.name);
}

function indexChain(fields: string[]): string {
  return fields
    .map((field) => `.index("by_${field}", ["${field}"])`)
    .join("\n    ");
}

function packageTableEntry(definition: DocTypeDefinition): string {
  const fields = definition.fields
    .map((field) => `    ${field.name}: ${fieldValidator(field)},`)
    .join("\n");
  const indexes = indexChain(filterableFields(definition));
  return `  ${recordTable(definition.name)}: defineTable({
    owner: v.string(),
    creation: v.number(),
    modified: v.number(),
    docstatus: v.number(),
${fields}
  })${indexes ? `\n    ${indexes}` : ""},`;
}

function normalizeEntry(entry: MaterializationEntry): {
  field: string;
  staged: boolean;
} {
  return typeof entry === "string"
    ? { field: entry, staged: false }
    : { field: entry.field, staged: entry.staged === true };
}

function materializedTableEntry(
  doctype: string,
  entries: MaterializationEntry[],
): string {
  const indexes = entries
    .map(normalizeEntry)
    .map(({ field, staged }) =>
      staged
        ? `.index("by_${field}", { fields: ["${field}"], staged: true })`
        : `.index("by_${field}", ["${field}"])`,
    )
    .join("\n    ");
  return `  ${recordTable(doctype)}: defineTable(v.any())${
    indexes ? `\n    ${indexes}` : ""
  },`;
}

function typeEntry(definition: DocTypeDefinition): string {
  const fields = definition.fields.map(fieldTsType).join("\n");
  return `export type ${pascalCase(definition.name)} = {\n${fields}\n};`;
}

// Emits convex/doctypes.gen.ts: table entries (typed validators for package
// DocTypes, `v.any()` + indexes for materialized site DocTypes), the
// nativeIndexes registry the repository consults, the parsed package
// definitions for `doctypes.sync`, and one TS type per package DocType.
export function generateDoctypesModule(
  definitions: DocTypeDefinition[],
  materializations: Record<string, MaterializationEntry[]>,
): string {
  const sortedDefinitions = [...definitions].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );
  const sortedMaterializations = Object.keys(materializations)
    .sort()
    .map((name) => [name, materializations[name] ?? []] as const);

  const tables = [
    ...sortedMaterializations.map(([name, entries]) =>
      materializedTableEntry(name, entries),
    ),
    ...sortedDefinitions.map(packageTableEntry),
  ]
    .sort()
    .join("\n");

  // Staged entries are deliberately absent: not native until enabled.
  const native = [
    ...sortedMaterializations.map(
      ([name, entries]) =>
        [
          name,
          entries
            .map(normalizeEntry)
            .filter(({ staged }) => !staged)
            .map(({ field }) => field),
        ] as const,
    ),
    ...sortedDefinitions.map(
      (definition) => [definition.name, filterableFields(definition)] as const,
    ),
  ]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([name, fields]) =>
        `  ${name}: [${fields.map((field) => JSON.stringify(field)).join(", ")}],`,
    )
    .join("\n");

  const packageJson = JSON.stringify(
    sortedDefinitions.map(
      (definition) =>
        JSON.parse(serializeDefinition(definition)) as DocTypeDefinition,
    ),
    null,
    2,
  );

  const types = sortedDefinitions.map(typeEntry).join("\n\n");

  return `// Generated by scripts/codegen-doctypes.ts — do not edit.
// Deterministic output of (doctypes/*.json + doctypes/materializations.json).
import { defineTable } from "convex/server";
import { v } from "convex/values";
import type { DocTypeDefinition } from "./doctype/definition";

export const doctypeTables = {
${tables}
};

export const nativeIndexes: Record<string, readonly string[]> = {
${native}
};

export const packageDefinitions: DocTypeDefinition[] = ${packageJson};
${types === "" ? "" : `\n${types}\n`}`;
}

// Emits convex/hooks.gen.ts: the registry wiring hook modules to DocType names.
export function generateHooksModule(definitions: DocTypeDefinition[]): string {
  const sorted = [...definitions].sort((a, b) => (a.name < b.name ? -1 : 1));
  const imports = sorted
    .map(
      (definition) =>
        `import * as ${definition.name} from "./hooks/${definition.name}";`,
    )
    .join("\n");
  const names = sorted.map((definition) => definition.name).join(", ");
  return `// Generated by scripts/codegen-doctypes.ts — do not edit.
${imports}

export const hooks = { ${names} };
`;
}

// Emits convex/hooks/<name>.ts once per package DocType — user-owned
// afterwards, never regenerated over an existing file.
export function generateHookStub(definition: DocTypeDefinition): string {
  const typeName = pascalCase(definition.name);
  return `import type { ${typeName} } from "../doctypes.gen";

// Lifecycle hooks for the "${definition.name}" DocType — generated once, edit
// freely. \`validate\` throws to reject a save; \`beforeSave\` returns the data
// to store. Both run on create and update, after declarative validation.

export function validate(_data: ${typeName}): void {}

export function beforeSave(data: ${typeName}): ${typeName} {
  return data;
}
`;
}

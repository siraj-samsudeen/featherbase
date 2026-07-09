// The portable DocType definition format (ADR 0003): canonical JSON documents,
// validated on intake, serialized with a fixed key order so the promotion
// round-trip (DB → file → DB) is byte-identical.

export const FIELD_TYPES = ["text", "number", "boolean", "select"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

// Frappe-style system fields the engine writes on every record (Convex `_id`
// plays Frappe's `name`) — user fields may not shadow them.
export const RESERVED_FIELD_NAMES = [
  "name",
  "owner",
  "creation",
  "modified",
  "docstatus",
] as const;

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface FieldDefinition {
  name: string;
  label?: string;
  type: FieldType;
  required?: boolean;
  filterable?: boolean;
  options?: string[];
}

export interface DocTypeDefinition {
  name: string;
  label?: string;
  fields: FieldDefinition[];
}

export type RecordData = Record<string, string | number | boolean>;

export interface DocTypeHooks {
  validate?: (data: RecordData) => void;
  beforeSave?: (data: RecordData) => RecordData;
}

export function fail(message: string): never {
  throw new Error(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  what: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`unknown ${what} key "${key}"`);
  }
}

function checkName(value: unknown, what: string): string {
  if (typeof value !== "string" || !NAME_PATTERN.test(value)) {
    fail(`${what} must match ${NAME_PATTERN.source}`);
  }
  return value;
}

function checkType<T>(
  value: unknown,
  type: "string" | "boolean",
  what: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== type) fail(`${what} must be a ${type}`);
  return value as T;
}

function validateField(value: unknown): FieldDefinition {
  if (!isPlainObject(value)) fail("field must be an object");
  checkKeys(
    value,
    ["name", "label", "type", "required", "filterable", "options"],
    "field",
  );
  const name = checkName(value.name, "field name");
  if ((RESERVED_FIELD_NAMES as readonly string[]).includes(name)) {
    fail(`field name "${name}" is reserved`);
  }
  const type = value.type;
  if (!(FIELD_TYPES as readonly unknown[]).includes(type)) {
    fail(`unknown field type "${String(type)}"`);
  }
  const field: FieldDefinition = { name, type: type as FieldType };
  const label = checkType<string>(value.label, "string", "label");
  if (label !== undefined) field.label = label;
  if (checkType<boolean>(value.required, "boolean", "required")) {
    field.required = true;
  }
  if (checkType<boolean>(value.filterable, "boolean", "filterable")) {
    field.filterable = true;
  }
  if (type === "select") {
    const options = value.options;
    if (
      !Array.isArray(options) ||
      options.length === 0 ||
      options.some((option) => typeof option !== "string")
    ) {
      fail("select fields require a non-empty array of string options");
    }
    field.options = options as string[];
  } else if (value.options !== undefined) {
    fail("options are only allowed on select fields");
  }
  return field;
}

// Validates and normalizes (boolean flags kept only when true, so a definition
// has exactly one canonical encoding). Throws on the first violation.
export function validateDefinition(value: unknown): DocTypeDefinition {
  if (!isPlainObject(value)) fail("definition must be an object");
  checkKeys(value, ["name", "label", "fields"], "definition");
  const name = checkName(value.name, "doctype name");
  const label = checkType<string>(value.label, "string", "label");
  if (!Array.isArray(value.fields) || value.fields.length === 0) {
    fail("fields must be a non-empty array");
  }
  const fields = value.fields.map(validateField);
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.name)) fail(`duplicate field name "${field.name}"`);
    seen.add(field.name);
  }
  const definition: DocTypeDefinition = { name, fields };
  if (label !== undefined) definition.label = label;
  return definition;
}

// Canonical serialization: fixed key order, 2-space indent, trailing newline.
export function serializeDefinition(definition: DocTypeDefinition): string {
  const canonical = {
    name: definition.name,
    label: definition.label,
    fields: definition.fields.map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required,
      filterable: field.filterable,
      options: field.options,
    })),
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

export function parseDefinition(json: string): DocTypeDefinition {
  return validateDefinition(JSON.parse(json));
}

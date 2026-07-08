// The repository layer (vision invariant 2): the single seam all record
// access flows through, keyed on DocType metadata. Per-DocType tables +
// fieldIndex sidecar per ADR 0002; native-index path per ADR 0004.
import type { GenericDatabaseWriter, GenericDocument } from "convex/server";
import type { GenericId } from "convex/values";
import { nativeIndexes } from "../doctypes.gen";
import { hooks } from "../hooks.gen";
import { recordTable } from "./codegen";
import {
  fail,
  type DocTypeDefinition,
  type DocTypeHooks,
  type FieldDefinition,
  type RecordData,
} from "./definition";

export type RecordDoc = GenericDocument & {
  _id: GenericId<string>;
  _creationTime: number;
};

// Runtime-created tables can't appear in the generated DataModel, so dynamic
// access goes through this loose-but-honest model: any table name, any index
// name, documents as generic Convex values.
type DynamicDataModel = Record<
  string,
  {
    document: RecordDoc;
    fieldPaths: string;
    // A 4-tuple, not string[]: IndexRangeBuilder.eq() only chains while the
    // index-fields type has a literal length ahead of the cursor.
    indexes: Record<string, [string, string, string, string]>;
    searchIndexes: Record<string, never>;
    vectorIndexes: Record<string, never>;
  }
>;

export type DynamicDb = GenericDatabaseWriter<DynamicDataModel>;

// The one contained cast from the generated ctx.db (queries pass a reader;
// only mutations reach the write methods).
export function asDynamicDb(db: unknown): DynamicDb {
  return db as DynamicDb;
}

export interface StoredDoctype extends DocTypeDefinition {
  source: "package" | "site";
}

export interface ListOptions {
  filter?: { field: string; value: string | number | boolean };
  sort?: { field: string; direction: "asc" | "desc" };
}

// Hook modules are generated with per-DocType types (e.g. Invoice); the
// registry view is the untyped seam the repository calls through.
const hookRegistry = hooks as unknown as Record<
  string,
  DocTypeHooks | undefined
>;

export function validateData(
  doctype: DocTypeDefinition,
  data: RecordData,
): RecordData {
  const fields = new Set(doctype.fields.map((field) => field.name));
  for (const key of Object.keys(data)) {
    if (!fields.has(key)) fail(`unknown field "${key}"`);
  }
  for (const field of doctype.fields) {
    const value = data[field.name];
    if (value === undefined) {
      if (field.required) fail(`missing required field "${field.name}"`);
      continue;
    }
    const expected =
      field.type === "number"
        ? "number"
        : field.type === "boolean"
          ? "boolean"
          : "string";
    if (typeof value !== expected) {
      fail(`field "${field.name}" must be a ${expected}`);
    }
    if (
      field.type === "select" &&
      !(field.options ?? []).includes(value as string)
    ) {
      fail(
        `field "${field.name}" must be one of: ${(field.options ?? []).join(", ")}`,
      );
    }
  }
  return data;
}

// Code hooks are package-mode only (ADR 0003 §4); site DocTypes get the
// declarative validation above and nothing else.
function applyHooks(doctype: StoredDoctype, data: RecordData): RecordData {
  if (doctype.source !== "package") return data;
  const hooksFor = hookRegistry[doctype.name];
  const transformed = hooksFor?.beforeSave?.(data) ?? data;
  hooksFor?.validate?.(transformed);
  return transformed;
}

// Sidecar rows exist only for filterable fields without a native index, and
// only when the field has a value (ADR 0002 §3 — write amplification is
// opt-in per field).
function sidecarFields(doctype: DocTypeDefinition): FieldDefinition[] {
  const native = nativeIndexes[doctype.name] ?? [];
  return doctype.fields.filter(
    (field) => field.filterable === true && !native.includes(field.name),
  );
}

async function writeSidecar(
  db: DynamicDb,
  doctype: DocTypeDefinition,
  docId: string,
  data: RecordData,
): Promise<void> {
  for (const field of sidecarFields(doctype)) {
    const value = data[field.name];
    if (value === undefined) continue;
    await db.insert("fieldIndex", {
      doctype: doctype.name,
      field: field.name,
      value,
      docId,
    });
  }
}

async function clearSidecarForDoc(
  db: DynamicDb,
  doctypeName: string,
  docId: string,
): Promise<void> {
  const rows = await db
    .query("fieldIndex")
    .withIndex("by_doctype_docId", (q) =>
      q.eq("doctype", doctypeName).eq("docId", docId),
    )
    .collect();
  for (const row of rows) {
    await db.delete(row._id);
  }
}

export async function createRecord(
  db: DynamicDb,
  doctype: StoredDoctype,
  data: RecordData,
  owner: string,
): Promise<string> {
  const validated = applyHooks(doctype, validateData(doctype, data));
  const now = Date.now();
  const docId = await db.insert(recordTable(doctype.name), {
    ...validated,
    owner,
    creation: now,
    modified: now,
    docstatus: 0,
  });
  await writeSidecar(db, doctype, docId, validated);
  return docId;
}

export async function getRecord(
  db: DynamicDb,
  doctype: DocTypeDefinition,
  id: string,
): Promise<RecordDoc | null> {
  const docId = db.normalizeId(recordTable(doctype.name), id);
  if (docId === null) return null;
  return await db.get(docId);
}

async function requireRecord(
  db: DynamicDb,
  doctype: DocTypeDefinition,
  id: string,
): Promise<RecordDoc> {
  const doc = await getRecord(db, doctype, id);
  if (doc === null) fail("record not found");
  return doc;
}

function extractUserData(
  doctype: DocTypeDefinition,
  doc: RecordDoc,
): RecordData {
  const data: RecordData = {};
  for (const field of doctype.fields) {
    const value = doc[field.name];
    if (value !== undefined) {
      data[field.name] = value as string | number | boolean;
    }
  }
  return data;
}

export async function updateRecord(
  db: DynamicDb,
  doctype: StoredDoctype,
  id: string,
  data: RecordData,
): Promise<void> {
  const doc = await requireRecord(db, doctype, id);
  const merged = applyHooks(
    doctype,
    validateData(doctype, { ...extractUserData(doctype, doc), ...data }),
  );
  await db.patch(doc._id, { ...merged, modified: Date.now() });
  await clearSidecarForDoc(db, doctype.name, doc._id);
  await writeSidecar(db, doctype, doc._id, merged);
}

export async function deleteRecord(
  db: DynamicDb,
  doctype: DocTypeDefinition,
  id: string,
): Promise<void> {
  const doc = await requireRecord(db, doctype, id);
  await db.delete(doc._id);
  await clearSidecarForDoc(db, doctype.name, doc._id);
}

function resolveQueryField(
  doctype: DocTypeDefinition,
  name: string,
  native: readonly string[],
): FieldDefinition {
  const field = doctype.fields.find((candidate) => candidate.name === name);
  if (field === undefined) fail(`unknown field "${name}"`);
  if (field.filterable !== true && !native.includes(field.name)) {
    fail(`field "${name}" is not filterable`);
  }
  return field;
}

async function hydrate(
  db: DynamicDb,
  table: string,
  rows: RecordDoc[],
): Promise<RecordDoc[]> {
  const docs: RecordDoc[] = [];
  for (const row of rows) {
    const docId = db.normalizeId(table, row.docId as string);
    const doc = docId === null ? null : await db.get(docId);
    if (doc !== null) docs.push(doc);
  }
  return docs;
}

function sortDocs(
  docs: RecordDoc[],
  field: string,
  direction: "asc" | "desc",
): RecordDoc[] {
  return docs
    .filter((doc) => doc[field] !== undefined)
    .sort((a, b) => {
      const aValue = a[field] as string | number | boolean;
      const bValue = b[field] as string | number | boolean;
      const cmp = aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      return direction === "desc" ? -cmp : cmp;
    });
}

// Filter/sort path per field: native index when the deployed registry has
// one, sidecar when the field is filterable, otherwise reject — never a
// silent full scan (ADR 0002).
export async function listRecords(
  db: DynamicDb,
  doctype: DocTypeDefinition,
  options: ListOptions = {},
): Promise<RecordDoc[]> {
  const table = recordTable(doctype.name);
  const native = nativeIndexes[doctype.name] ?? [];
  const { filter, sort } = options;
  if (filter !== undefined) {
    const field = resolveQueryField(doctype, filter.field, native);
    const docs = native.includes(field.name)
      ? await db
          .query(table)
          .withIndex(`by_${field.name}`, (q) =>
            q.eq(field.name, filter.value),
          )
          .collect()
      : await hydrate(
          db,
          table,
          await db
            .query("fieldIndex")
            .withIndex("by_doctype_field_value", (q) =>
              q
                .eq("doctype", doctype.name)
                .eq("field", field.name)
                .eq("value", filter.value),
            )
            .collect(),
        );
    if (sort === undefined) return docs;
    const sortField = resolveQueryField(doctype, sort.field, native);
    return sortDocs(docs, sortField.name, sort.direction);
  }
  if (sort !== undefined) {
    const field = resolveQueryField(doctype, sort.field, native);
    if (native.includes(field.name)) {
      return await db
        .query(table)
        .withIndex(`by_${field.name}`)
        .order(sort.direction)
        .collect();
    }
    const rows = await db
      .query("fieldIndex")
      .withIndex("by_doctype_field_value", (q) =>
        q.eq("doctype", doctype.name).eq("field", field.name),
      )
      .order(sort.direction)
      .collect();
    return await hydrate(db, table, rows);
  }
  return await db.query(table).collect();
}

// Materialization cleanup (ADR 0004): after a deploy flips a field's path to
// native, its sidecar rows are dead weight — drop them.
export async function clearSidecar(
  db: DynamicDb,
  doctypeName: string,
  fields: readonly string[],
): Promise<void> {
  for (const field of fields) {
    const rows = await db
      .query("fieldIndex")
      .withIndex("by_doctype_field_value", (q) =>
        q.eq("doctype", doctypeName).eq("field", field),
      )
      .collect();
    for (const row of rows) {
      await db.delete(row._id);
    }
  }
}

// The reverse rung: after a de-materializing deploy, re-derive sidecar rows
// from the record table so the sidecar path serves the DocType again.
export async function rebuildSidecar(
  db: DynamicDb,
  doctype: StoredDoctype,
): Promise<void> {
  const docs = await db.query(recordTable(doctype.name)).collect();
  for (const doc of docs) {
    await clearSidecarForDoc(db, doctype.name, doc._id);
    await writeSidecar(db, doctype, doc._id, extractUserData(doctype, doc));
  }
}

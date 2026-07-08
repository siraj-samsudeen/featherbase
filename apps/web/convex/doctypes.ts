// DocType management: definitions in/out (ADR 0003) and the materialization
// ladder rungs (ADR 0004). All record access lives in records.ts.
import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireUser } from "./doctype/auth";
import {
  fail,
  serializeDefinition,
  validateDefinition,
  type DocTypeDefinition,
} from "./doctype/definition";
import {
  asDynamicDb,
  clearSidecar,
  rebuildSidecar as repositoryRebuildSidecar,
  type StoredDoctype,
} from "./doctype/repository";
import { nativeIndexes, packageDefinitions } from "./doctypes.gen";

async function findDoctype(
  ctx: QueryCtx,
  name: string,
): Promise<Doc<"doctypes"> | null> {
  return await ctx.db
    .query("doctypes")
    .withIndex("by_name", (q) => q.eq("name", name))
    .unique();
}

export async function requireDoctype(
  ctx: QueryCtx,
  name: string,
): Promise<Doc<"doctypes">> {
  const row = await findDoctype(ctx, name);
  if (row === null) fail(`unknown doctype "${name}"`);
  return row;
}

function toDefinition(row: Doc<"doctypes">): DocTypeDefinition {
  const definition: DocTypeDefinition = { name: row.name, fields: row.fields };
  if (row.label !== undefined) definition.label = row.label;
  return definition;
}

export function toStored(row: Doc<"doctypes">): StoredDoctype {
  return { ...toDefinition(row), source: row.source };
}

export const create = mutation({
  args: { definition: v.any() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const candidate: unknown = args.definition;
    const definition = validateDefinition(candidate);
    if ((await findDoctype(ctx, definition.name)) !== null) {
      fail(`doctype "${definition.name}" already exists`);
    }
    await ctx.db.insert("doctypes", { ...definition, source: "site" });
    return null;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("doctypes").collect();
    return rows.map(toStored);
  },
});

export const get = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const row = await findDoctype(ctx, args.name);
    return row === null ? null : toStored(row);
  },
});

// Deploy-time sync (ADR 0003 §2): upserts every package definition from the
// generated module into the metadata table. Idempotent.
export const sync = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    for (const definition of packageDefinitions) {
      const existing = await findDoctype(ctx, definition.name);
      if (existing === null) {
        await ctx.db.insert("doctypes", { ...definition, source: "package" });
      } else {
        await ctx.db.patch(existing._id, {
          label: definition.label,
          fields: definition.fields,
          source: "package",
        });
      }
    }
    return null;
  },
});

// Promotion (ADR 0003 §5): flips source and returns the canonical JSON — the
// exact file content for doctypes/<name>.json. Zero data movement; idempotent
// (re-promoting just re-emits the file).
export const promote = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const row = await requireDoctype(ctx, args.name);
    await ctx.db.patch(row._id, { source: "package" });
    return serializeDefinition(toDefinition(row));
  },
});

export const demote = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const row = await requireDoctype(ctx, args.name);
    await ctx.db.patch(row._id, { source: "site" });
    return null;
  },
});

// Materialization cleanup rung (ADR 0004): the deploy itself flips the query
// path (the repository consults the generated nativeIndexes registry), so
// this mutation only verifies the deploy happened and drops dead sidecar rows.
export const materialize = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const row = await requireDoctype(ctx, args.name);
    const native = nativeIndexes[row.name];
    if (native === undefined) {
      fail(
        `doctype "${row.name}" has no deployed native indexes — add it to doctypes/materializations.json, run gen:doctypes, and deploy first`,
      );
    }
    await clearSidecar(asDynamicDb(ctx.db), row.name, native);
    return null;
  },
});

// The reverse rung: after a de-materializing deploy, re-derive sidecar rows.
export const rebuildSidecar = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const row = await requireDoctype(ctx, args.name);
    await repositoryRebuildSidecar(asDynamicDb(ctx.db), toStored(row));
    return null;
  },
});

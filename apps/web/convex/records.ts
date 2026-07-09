// Generic record access for every DocType — the public face of the
// repository layer. Convex functions are deploy-time artifacts, so runtime
// (site) DocTypes share this one function set, keyed by DocType name.
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./doctype/auth";
import { requireDoctype, toStored } from "./doctypes";
import {
  asDynamicDb,
  createRecord,
  deleteRecord,
  getRecord,
  listRecords,
  updateRecord,
} from "./doctype/repository";

const dataValidator = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean()),
);

export const create = mutation({
  args: { doctype: v.string(), data: dataValidator },
  handler: async (ctx, args) => {
    const owner = await requireUser(ctx);
    const row = await requireDoctype(ctx, args.doctype);
    return await createRecord(
      asDynamicDb(ctx.db),
      toStored(row),
      args.data,
      owner,
    );
  },
});

export const get = query({
  args: { doctype: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const row = await requireDoctype(ctx, args.doctype);
    return await getRecord(asDynamicDb(ctx.db), toStored(row), args.id);
  },
});

export const update = mutation({
  args: { doctype: v.string(), id: v.string(), data: dataValidator },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const row = await requireDoctype(ctx, args.doctype);
    await updateRecord(asDynamicDb(ctx.db), toStored(row), args.id, args.data);
    return null;
  },
});

export const remove = mutation({
  args: { doctype: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const row = await requireDoctype(ctx, args.doctype);
    await deleteRecord(asDynamicDb(ctx.db), toStored(row), args.id);
    return null;
  },
});

export const list = query({
  args: {
    doctype: v.string(),
    filter: v.optional(
      v.object({
        field: v.string(),
        value: v.union(v.string(), v.number(), v.boolean()),
      }),
    ),
    sort: v.optional(
      v.object({
        field: v.string(),
        direction: v.union(v.literal("asc"), v.literal("desc")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const row = await requireDoctype(ctx, args.doctype);
    return await listRecords(asDynamicDb(ctx.db), toStored(row), {
      filter: args.filter,
      sort: args.sort,
    });
  },
});

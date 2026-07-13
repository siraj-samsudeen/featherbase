import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import { doctypeTables } from "./doctypes.gen";

export default defineSchema({
  // Convex Auth's tables — its `users` (all-optional fields) replaces the
  // capability-1 bare table, so existing rows and `v.id("users")` refs hold.
  ...authTables,
  tasks: defineTable({
    userId: v.id("users"),
    text: v.string(),
    completed: v.boolean(),
  }).index("by_userId", ["userId"]),

  // DocType metadata (ADR 0003): one row per DocType, portable definition +
  // engine state. Site-source record tables are NOT declared here — Convex
  // auto-creates them on first insert (ADR 0002).
  doctypes: defineTable({
    name: v.string(),
    label: v.optional(v.string()),
    fields: v.array(
      v.object({
        name: v.string(),
        label: v.optional(v.string()),
        type: v.union(
          v.literal("text"),
          v.literal("number"),
          v.literal("boolean"),
          v.literal("select"),
        ),
        required: v.optional(v.boolean()),
        filterable: v.optional(v.boolean()),
        options: v.optional(v.array(v.string())),
      }),
    ),
    source: v.union(v.literal("package"), v.literal("site")),
  }).index("by_name", ["name"]),

  // Fixed sidecar (ADR 0002): its deploy-time composite index serves
  // filter/sort for arbitrary user-defined fields on runtime tables forever.
  fieldIndex: defineTable({
    doctype: v.string(),
    field: v.string(),
    value: v.union(v.string(), v.number(), v.boolean()),
    docId: v.string(),
  })
    .index("by_doctype_field_value", ["doctype", "field", "value"])
    .index("by_doctype_docId", ["doctype", "docId"]),

  // Generated (ADR 0004): typed tables for package DocTypes, v.any() +
  // native indexes for materialized site DocTypes.
  ...doctypeTables,
});

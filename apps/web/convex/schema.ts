import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({}),
  tasks: defineTable({
    userId: v.id("users"),
    text: v.string(),
    completed: v.boolean(),
  }).index("by_userId", ["userId"]),
});

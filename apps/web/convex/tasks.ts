import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      return [];
    }
    return await ctx.db
      .query("tasks")
      .withIndex("by_userId", (q) =>
        q.eq("userId", identity.subject as Id<"users">),
      )
      .collect();
  },
});

export const add = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new Error("Not authenticated");
    }
    const text = args.text.trim();
    if (text === "") {
      throw new Error("Task text cannot be empty");
    }
    return await ctx.db.insert("tasks", {
      userId: identity.subject as Id<"users">,
      text,
      completed: false,
    });
  },
});

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./doctype/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }
    return await ctx.db
      .query("tasks")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const add = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const text = args.text.trim();
    if (text === "") {
      throw new Error("Task text cannot be empty");
    }
    return await ctx.db.insert("tasks", {
      userId,
      text,
      completed: false,
    });
  },
});

import type { Auth } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";

// Every doctype/record function requires an authenticated caller — queries
// included (real permission semantics arrive with the authorization
// capability). Convex Auth encodes `${userId}|${sessionId}` in the subject
// claim; getAuthUserId returns the user half, so record ownership doesn't
// fragment per session.
export async function requireUser(ctx: { auth: Auth }): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not authenticated");
  }
  return userId;
}

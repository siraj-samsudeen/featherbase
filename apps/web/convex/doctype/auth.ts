import type { Auth } from "convex/server";

// Every doctype/record function requires an authenticated caller — queries
// included (capability 1's lenient unauthenticated `[]` existed for a UI this
// layer doesn't have; real permission semantics arrive with capability 5).
export async function requireUser(ctx: { auth: Auth }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new Error("Not authenticated");
  }
  return identity.subject;
}

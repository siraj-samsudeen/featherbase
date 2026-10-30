import { z } from 'zod'

/** Versioned metadata ceiling on grants, including administrators and shares. */
export const accessPolicySchema = z.object({
  version: z.literal(1),
  roles: z.array(z.string().min(1)).min(1).refine(roles => !roles.some(role => ['All', 'Guest'].includes(role))),
  shared_column: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  inherit_column: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
}).strict()
export type AccessPolicy = z.infer<typeof accessPolicySchema>

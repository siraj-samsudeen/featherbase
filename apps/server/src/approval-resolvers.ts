// #627: who counts as whom. An app that owns the meaning of "the site lead of this row" supplies a
// resolver: given a row, it names the people (Person ids). Approval rules refer to it as
// `<app>.<resolver>`. A resolver is reachable only while its app runs, so turning the app off
// leaves rules that name it with nobody, and the changes they cover are refused rather than let
// through.
export type ApprovalResolverFn = (table: string, row: Record<string, unknown>) => Promise<unknown>

const registry = new Map<string, Map<string, ApprovalResolverFn>>()

export function registerApprovalResolvers(app: string, resolvers: Record<string, ApprovalResolverFn> | undefined) {
  if (!resolvers || !Object.keys(resolvers).length) return
  registry.set(app, new Map(Object.entries(resolvers)))
}

export function unregisterApprovalResolvers(app: string) {
  registry.delete(app)
}

/** The resolver a rule names, as `<app>.<resolver>`, while its app runs. */
export function approvalResolver(name: string): ApprovalResolverFn | undefined {
  const dot = name.indexOf('.')
  if (dot <= 0) return undefined
  return registry.get(name.slice(0, dot))?.get(name.slice(dot + 1))
}

/** Every resolver that can be named now, for a rule's check and the Admin form. */
export function approvalResolverNames(): string[] {
  return [...registry.entries()].flatMap(([app, fns]) => [...fns.keys()].map(fn => `${app}.${fn}`)).sort()
}

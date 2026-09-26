export type AppAccessPolicy = { kind: 'table' } | {
  kind: 'stores'
  storeTable: string
  readRoles: string[]
  actionRoles: string[]
}
export interface AppFactDeclaration { table: string; columns: string[] }
export type AppScopeSource = { kind: 'request' } | { kind: 'resolver'; name: string; facts: AppFactDeclaration[] }
export type AppProductAuthorization = { kind: 'generic' } | { kind: 'product'; name: string; facts: AppFactDeclaration[] }
export type AppOperationDeclaration = {
  authorization: AppProductAuthorization
} & ({ policy: Extract<AppAccessPolicy, { kind: 'table' }> } | {
  policy: Extract<AppAccessPolicy, { kind: 'stores' }>
  scope: AppScopeSource
  discoverStoreAccess?: true
})
export interface AppScopeFacts {
  get(table: string, rowId: string): Promise<Readonly<Record<string, unknown>>>
}
export interface AppScopeResolutionContext {
  readonly user: string
  readonly payload: unknown
  readonly requestedStoreCodes: readonly string[] | undefined
  readonly facts: AppScopeFacts
  reject(): never
}
export interface ResolvedAppScope {
  readonly storeCodes: readonly string[]
  readonly productScope?: unknown
}
export type AppScopeResolver = (context: AppScopeResolutionContext) => ResolvedAppScope | Promise<ResolvedAppScope>
export interface AppAuthorizationContext {
  readonly app: string
  readonly user: string
  readonly operation: string
  readonly policy: 'table' | 'stores'
  readonly storeCodes: readonly string[]
  readonly productScope?: unknown
}
export interface AppProductAuthorizationContext {
  readonly authorization: AppAuthorizationContext
  readonly payload: unknown
  readonly facts: AppScopeFacts
  reject(): never
}
export type AppProductAuthorizer = (context: AppProductAuthorizationContext) => true | Promise<true>
export interface RuntimeActionAuthorization {
  version: 1
  policy: 'table' | 'stores'
  storeTable?: string
  storeCodes: readonly string[]
  productScope?: unknown
}

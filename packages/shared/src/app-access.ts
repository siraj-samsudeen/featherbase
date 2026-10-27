import type { ActionListArgs, ActionRow } from './runtime-actions'
import type { PersonScope } from './person-scope'

export type AppAccessPolicy = { kind: 'table' } | {
  kind: 'stores'
  storeTable: string
  readRoles: string[]
  actionRoles: string[]
} | {
  // #559: scoped by the places the caller covers, as the instance's one
  // scope-providing app says.
  kind: 'person_scope'
  readRoles: string[]
  actionRoles: string[]
}
export interface AppFactDeclaration { table: string; columns: string[] }
export type AppScopeSource = { kind: 'request' } | { kind: 'resolver'; name: string; facts: AppFactDeclaration[] }
export type AppProductAuthorization = { kind: 'generic' } | { kind: 'product'; name: string; facts: AppFactDeclaration[] }
export type AppOperationDeclaration = {
  authorization: AppProductAuthorization
  /** #625 (E5): a read whose handler runs after its authorization
   *  transaction has closed, so it may call out to a slow outside store. */
  outbound?: true
} & ({ policy: Extract<AppAccessPolicy, { kind: 'table' }> } | {
  policy: Extract<AppAccessPolicy, { kind: 'stores' }>
  scope: AppScopeSource
  discoverStoreAccess?: true
} | { policy: Extract<AppAccessPolicy, { kind: 'person_scope' }> })
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
  readonly policy: 'table' | 'stores' | 'person_scope'
  readonly storeCodes: readonly string[]
  readonly productScope?: unknown
  /** person_scope: the caller's places, narrowed to what the request names. */
  readonly places?: PersonScope
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
  policy: 'table' | 'stores' | 'person_scope'
  storeTable?: string
  storeCodes: readonly string[]
  productScope?: unknown
  places?: PersonScope
}

// #559: an app that provides people's scope exports this function by the name
// its manifest's `scopeProvider` declares. It reads only the Tables it
// declared, each marked as deciding scope, and returns the person's places;
// the platform validates the answer against the scope shape.
export interface AppScopeProviderContext {
  readonly person: {
    readonly id: string
    readonly email: string | null
    /** #660: the person's current values in each identifier system the
     *  manifest's `scopeProvider.identifiers` names, and no other system. */
    readonly identifiers: Readonly<Record<string, readonly string[]>>
  }
  readonly documents: {
    get(table: string, rowId: string): Promise<ActionRow>
    list(table: string, args?: ActionListArgs): Promise<ActionRow[]>
  }
}
export type AppScopeProvider = (context: AppScopeProviderContext) => PersonScope | Promise<PersonScope>

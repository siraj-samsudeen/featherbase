import type { AppAuthorizationContext } from './app-access'

export type ActionRow = Record<string, unknown>
export interface ActionListArgs {
  filters?: [string, string, unknown][]
  fields?: string[]
  order_by?: string
  limit_start?: number
  limit_page_length?: number
}

// Structural package API: no core exception, SQL handle or identity override.
export interface RuntimeActionContext {
  readonly user: string
  readonly payload: unknown
  readonly authorization: AppAuthorizationContext
  reject(message: string, fields?: Record<string, string>): never
  readonly documents: {
    get(table: string, rowId: string): Promise<ActionRow>
    list(table: string, args?: ActionListArgs): Promise<ActionRow[]>
    create(table: string, values: ActionRow): Promise<ActionRow>
    update(table: string, values: ActionRow): Promise<ActionRow>
    delete(table: string, rowId: string, updatedAt: string): Promise<void>
    activity(table: string, rowId: string): Promise<{ comments: ActionRow[]; versions: ActionRow[] }>
    deletionState(table: string, rowId: string): Promise<{ comments: number; versions: number; references: number; files: number; shares: number }>
  }
}

export type RuntimeActionHandler = (context: RuntimeActionContext) => unknown | Promise<unknown>

export interface RuntimeReadContext extends Omit<RuntimeActionContext, 'documents'> {
  readonly documents: Pick<RuntimeActionContext['documents'], 'get' | 'list' | 'activity'>
}
export type RuntimeReadHandler = (context: RuntimeReadContext) => unknown | Promise<unknown>

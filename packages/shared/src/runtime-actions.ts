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
  /** #620: the app's declared settings that hold a value on this instance. */
  readonly settings: Readonly<Record<string, string>>
  /** #620: the app's declared secrets (deployment variables) that are set.
   *  Never return, log or store one. */
  readonly secrets: Readonly<Record<string, string>>
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

/** #625: one shaped dataset row, keyed by the declared column names. */
export type DatasetRow = Record<string, string | number | boolean | null>
/** #625: equality (one value) or `in` (a list) on the dataset's declared keys. */
export type DatasetFilters = Record<string, string | number | (string | number)[]>
export interface DatasetAnswer {
  readonly dataset: string
  readonly served: 'cached' | 'live'
  /** When the snapshot was activated, or when the live rows were fetched (ISO). */
  readonly at: string
  readonly rows: DatasetRow[]
}

export interface RuntimeReadContext extends Omit<RuntimeActionContext, 'documents'> {
  readonly documents: Pick<RuntimeActionContext['documents'], 'get' | 'list' | 'activity'>
  /** #625 (E3): the app's declared datasets, limited to the reader's places. */
  readonly datasets: {
    /** The active snapshot's rows, or null when none has built yet (the ask is recorded). */
    active(name: string, filters?: DatasetFilters): Promise<DatasetAnswer | null>
    /** The same query run on the source now, limited to the same rows and
     *  shaped the same way. Only in a read declared `outbound` (E5). */
    live(name: string, filters?: DatasetFilters): Promise<DatasetAnswer>
  }
  /** #625 (E5): write one Access Log row for the viewing person. The platform
   *  fills in who, the places, and what this read served for `dataset`. */
  recordView(details?: { dataset?: string }): Promise<void>
}
export type RuntimeReadHandler = (context: RuntimeReadContext) => unknown | Promise<unknown>

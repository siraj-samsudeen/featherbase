import type { AppAuthorizationContext } from './app-access'

export type ActionRow = Record<string, unknown>
export interface ActionListArgs {
  filters?: [string, string, unknown][]
  fields?: string[]
  order_by?: string
  limit_start?: number
  limit_page_length?: number
}

/** #975: who may approve. The people who can sign in, else the holders of the roles; never the maker. */
export interface ApproverRequest { people: string[]; fallbackRoles: string[] }
export type ChangeProposalState = 'Pending' | 'Applied' | 'Rejected' | 'Needs fresh review' | 'Withdrawn'
  /** #1191: applied when asked for, waiting for a reviewer; then confirmed, or undone. */
  | 'Not yet reviewed' | 'Confirmed' | 'Undone'
/** #1191: how an approval type works, set per type in the Approval Type Table. */
export type ApprovalMode = 'Approve first' | 'Apply now, review after'
export interface ProposalRequest {
  table: string
  /** The row to end and replace; null for a new row. */
  row: string | null
  changes: Record<string, string | null>
  /** Declared columns that must still hold their value at approval, though not changed: what makes it this row. */
  reviewed?: string[]
  approvers: ApproverRequest
  about?: Record<string, unknown>
  /** #1175: approving ends the row and adds nothing in its place; `changes` is then empty. */
  ends?: boolean
  /** #1191: one of the app's declared approval types; its mode decides whether this applies at once. */
  type?: string
  /** #1191: what applying needs, used only when the type applies at once: as an approval's. */
  apply?: Pick<DecisionApproval, 'effectiveOn' | 'newRow'>
}
export interface ProposalFilter { ids?: string[]; states?: ChangeProposalState[]; makers?: string[]; limit?: number; start?: number }
export interface ChangeProposal {
  row_id: string
  app: string
  target_table: string
  target_row: string | null
  maker: string
  state: ChangeProposalState
  about: Record<string, unknown> | null
  decided_by: string | null
  decided_at: string | null
  decision_reason: string | null
  result_row: string | null
  /** #1175: approving ends the row and adds nothing. */
  ends_row: boolean
  /** #1191: the declared type it was made as, and the mode it was made under. */
  approval_type: string | null
  approval_mode: ApprovalMode
  created_at: string
  changes: { column_name: string; original_value: string | null; proposed_value: string | null; review_base_value: string | null }[]
  /** Who it waits for: named people, or else roles. */
  route: { people: string[]; roles: string[] }
}
export interface DecisionNote { approvers: ApproverRequest; reason: string }
/** #1191: a reviewer's confirmation of an applied change, with an optional note. */
export interface ReviewConfirmation { approvers: ApproverRequest; note?: string }
/** #1191: an undo. A reviewer gives a reason; the maker undoing their own needs none. */
export interface ReviewUndo { approvers: ApproverRequest; reason?: string }
export interface DecisionApproval {
  approvers: ApproverRequest
  /** The day the new row starts; the old row ends the day before. */
  effectiveOn: string
  /** Declared `stamp` columns for the new row, such as its identifier. */
  newRow?: Record<string, string | null>
  /** #1175: the approver's own values for columns the proposal changes, applied in place of the proposed ones. */
  instead?: Record<string, string | null>
  /** What the maker reads about the decision, such as what was done instead. */
  reason?: string
}
/** #975: declared base Tables, read as the app: the fields named must be declared. */
export interface BaseTablesHelper {
  list(table: string, args: ActionListArgs & { fields: string[] }): Promise<ActionRow[]>
}
export interface ChangeProposalsReader {
  list(filter?: ProposalFilter): Promise<ChangeProposal[]>
  /** Whether the caller may decide a proposal by this maker, with these approvers. */
  mayDecide(maker: string, approvers: ApproverRequest): Promise<boolean>
  /** Who these approvers come to now for this maker; null when nobody can act. */
  routeFor(maker: string, approvers: ApproverRequest): Promise<{ people: string[]; roles: string[] } | null>
  /** #1191: how one of the app's declared approval types works on this instance now. */
  modeOf(type: string): Promise<ApprovalMode>
}
export interface ChangeProposalsHelper extends ChangeProposalsReader {
  /** Holds a declared base row until the action commits. */
  lockRow(table: string, rowId: string): Promise<void>
  /** Queues decisions that share this key until the action commits. */
  serialize(key: string): Promise<void>
  propose(request: ProposalRequest): Promise<ChangeProposal>
  approve(id: string, decision: DecisionApproval): Promise<ChangeProposal>
  reject(id: string, decision: DecisionNote): Promise<ChangeProposal>
  needsFreshReview(id: string, decision: DecisionNote): Promise<ChangeProposal>
  /** #1175: the maker takes back their own pending proposal. */
  withdraw(id: string): Promise<ChangeProposal>
  /** #1191: a reviewer confirms a change that applied at once. */
  confirm(id: string, decision: ReviewConfirmation): Promise<ChangeProposal>
  /** #1191: a reviewer, or the maker, puts the rows back as they were before it applied. */
  undo(id: string, decision: ReviewUndo): Promise<ChangeProposal>
}

// Structural package API: no core exception, SQL handle or identity override.
export interface RuntimeActionContext {
  readonly user: string
  /** #912: the caller's own display name (full name, else @username), as
   *  they see it themselves. Never another person's name or address. */
  readonly userName: string
  /** #918: the roles the caller holds (never another person's). */
  readonly roles: readonly string[]
  /** #912: display names for person ids, as the caller may see them: a
   *  person the caller may not read maps to null. Never contact data. */
  readonly people: {
    names(ids: string[]): Promise<Record<string, string | null>>
    /** #963: which of these ids are enabled people, as the caller may see them:
     *  never a built-in or merged-away account, nor a service account. */
    enabled(ids: string[]): Promise<string[]>
    /** #1046: the roles an enabled person holds now, read fresh; none for
     *  anyone else. For an app that gives things to roles, to say why. */
    rolesOf(person: string): Promise<readonly string[]>
    /** #1046: every role on the instance, platform roles left out. */
    roleNames(): Promise<readonly string[]>
    /** #1046: who is waiting for access to this app, oldest first. Only a
     *  System Manager or one of the app's access approvers is told. */
    waitingForAccess(): Promise<readonly { person: string; name: string | null; asked_at: string }[]>
  }
  readonly payload: unknown
  readonly authorization: AppAuthorizationContext
  /** #620: the app's declared settings that hold a value on this instance. */
  readonly settings: Readonly<Record<string, string>>
  /** #620: the app's declared secrets (deployment variables) that are set.
   *  Never return, log or store one. */
  readonly secrets: Readonly<Record<string, string>>
  reject(message: string, fields?: Record<string, string>): never
  /** #1001: email a person by Person ID. The platform holds the address. */
  readonly mail: {
    /** Whether this person may read this row of the app's own Tables, so an
     *  email to them can leave out what they could not read. */
    mayRead(person: string, table: string, rowId: string): Promise<boolean>
    /** Queues one email once this action commits: none if it rolls back, and a
     *  person with no usable email gets none (logged). A failure to queue never
     *  undoes the action. `path` follows the app's root in a link the platform
     *  appends, on the address that serves the app. */
    toPerson(person: string, message: { subject: string; body: string; path?: string; ref_table?: string; reference_name?: string }): Promise<void>
  }
  readonly documents: {
    get(table: string, rowId: string): Promise<ActionRow>
    members(table: string): Promise<{ row_id: string; full_name: string }[]>
    list(table: string, args?: ActionListArgs): Promise<ActionRow[]>
    create(table: string, values: ActionRow): Promise<ActionRow>
    update(table: string, values: ActionRow): Promise<ActionRow>
    delete(table: string, rowId: string, updatedAt: string): Promise<void>
    activity(table: string, rowId: string): Promise<{ comments: ActionRow[]; versions: ActionRow[] }>
    deletionState(table: string, rowId: string): Promise<{ comments: number; versions: number; references: number; files: number; shares: number }>
    /** #963: makes an enabled person the creator of one row of the app's own
     *  Table, so an own-rows grant follows the row. Only for a System Manager. */
    handOver(table: string, rowId: string, person: string): Promise<void>
    /** #925: whether setReaders names the caller as a reader of this row
     *  (and it still reads for them). Never fails the handler. */
    isReader(table: string, rowId: string): Promise<boolean>
    /** #925: who besides its usual readers reads one row of the app's own
     *  Table, read only, replacing the people set before. The caller must be
     *  able to read the row; a person who is not enabled is left out. */
    setReaders(table: string, rowId: string, people: string[]): Promise<void>
  }
  readonly baseTables: BaseTablesHelper
  readonly changeProposals: ChangeProposalsHelper
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

export interface RuntimeReadContext extends Omit<RuntimeActionContext, 'documents' | 'mail' | 'changeProposals'> {
  readonly documents: Pick<RuntimeActionContext['documents'], 'get' | 'list' | 'activity' | 'isReader'>
  /** #967: what this outbound read's `prepare` answered; undefined everywhere else. */
  readonly prepared?: unknown
  /** #975: a read can list proposals, never make or decide one. */
  readonly changeProposals: ChangeProposalsReader
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
export type RuntimeReadHandler = ((context: RuntimeReadContext) => unknown | Promise<unknown>) & {
  /** #967: an outbound read's first step, run in its transaction, where documents can be read.
   *  What it answers (as JSON) reaches the handler as `prepared`, after the transaction closes. */
  prepare?: (context: RuntimeReadContext) => unknown | Promise<unknown>
}

/** #700: the grants an app job may declare. A job holds only those it names. */
export const APP_JOB_GRANTS = ['read_people', 'disable_people', 'email_system_managers'] as const
export type AppJobGrant = (typeof APP_JOB_GRANTS)[number]

/** #700: one enabled person, as an app job holding `read_people` sees them. */
export interface AppJobPerson {
  readonly person: string
  readonly full_name: string | null
  readonly email: string | null
  /** Administrator or a System Manager: never disabled by a job. */
  readonly privileged: boolean
  /** Current values of the identifier systems the job declares, by system. */
  readonly identifiers: Readonly<Record<string, readonly string[]>>
}

/** #700: what an app's scheduled job handler gets. It runs as the job's own
 *  system actor, which holds no role: each capability below works only when
 *  the job declares the grant it needs, and is refused otherwise. */
export interface RuntimeJobContext {
  /** Stable run clock and the instance's configured timezone. */
  readonly now: string
  readonly timeZone: string
  readonly documents: {
    /** Server-selected enabled creators of the declared owner Table only. */
    forEachOwner(callback: (scope: { readonly user: string; readonly documents: RuntimeActionContext['documents'] }) => Promise<void>): Promise<void>
  }
  /** The job's registered name (`<app>.<job>`), which is also its actor. */
  readonly job: { readonly name: string; readonly run: string; readonly trigger: string }
  readonly settings: Readonly<Record<string, string>>
  /** Never return, log or store one. */
  readonly secrets: Readonly<Record<string, string>>
  /** The datasets the job declares, every row (a job has no places). */
  readonly datasets: RuntimeReadContext['datasets']
  readonly people: {
    /** `read_people`: every enabled person. */
    list(): Promise<AppJobPerson[]>
    /** `disable_people`: disable one person. False when they are already
     *  disabled, gone, or privileged (never disabled by a job). */
    disable(person: string, reason: string): Promise<boolean>
  }
  readonly email: {
    /** `email_system_managers`: mail every System Manager. The count mailed;
     *  0 when none has an address (recorded as an undelivered notice). */
    systemManagers(message: { subject: string; body: string }): Promise<number>
  }
  /** A one-line outcome kept on the run's record. */
  setResult(text: string): void
  /** End the run as refused: recorded and alerted, not retried. */
  refuse(reason: string): void
}
export type RuntimeJobHandler = (context: RuntimeJobContext) => unknown | Promise<unknown>

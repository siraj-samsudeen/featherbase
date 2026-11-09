import type { ColumnCombine, InferredTableDef } from 'shared'

export interface MappableColumn {
  column_name: string
  label: string | null
  column_type: string
}

export interface SheetPlan {
  // 'skip' means "parked — not selected on the overview". It is set ONLY by
  // the selection in step one (#200): leaving a sheet unselected is the one
  // way to exclude it, so the target picker has no skip of its own.
  mode: 'new' | 'existing' | 'skip'
  // #201: a merge group. `members` lists the sheet indices this plan speaks
  // for, itself first — [i] for an ordinary sheet, [i, j, k] for a group's
  // lead. `groupedInto` is set on the followers and names their lead, which
  // is how the column step knows to render one card instead of three.
  members: number[]
  groupedInto: number | null
  // #203: this target's own failure, if it threw. Kept per target so one
  // sheet's problem cannot erase another's result.
  failure: string | null
  // #993: set when nothing on the column step can fix the failure, so its
  // "Fix it" points to Past imports instead.
  failureAtPastImports?: boolean
  // #211: columns the USER declared to be one, which folding could never
  // work out — `Store Code` and `Store Name` are the same store to them and
  // to nothing else. Applied on top of the folded set, so the column grid,
  // the inference and the projection all see the result.
  combines: ColumnCombine[]
  // mode new: the Table name to create; mode existing: the target Table.
  table: string
  // Per file column, new-Table mode: import this column at all? (Existing
  // mode has the same control via the mapping's "— skip —".)
  include: boolean[]
  // New-Table mode: the Table this wizard has already made for the plan. Trying
  // again after a dropped connection must not ask to make it a second time.
  created_table?: string
  // #738, new-Table mode: the user's own "In list" ticks, per file column.
  // Absent until the user changes one; until then the ticks follow
  // listTicks' default, the first seven columns in use.
  list_ticks?: boolean[]
  // True when the existing target was picked by column-overlap scoring, not
  // by the user — surfaced as a notice so an unnoticed auto-match can't
  // quietly route rows into a lookalike Table.
  auto_matched: boolean
  // A near-match that didn't clear the auto-select bar (e.g. this sheet fits
  // inside a wider Table) — shown as a hint on the new-Table panel.
  similar: { name: string; mapped: number; total: number } | null
  inferred: InferredTableDef
  // NAM-001, new-Table mode: the new Table's id_pattern, edited through the
  // same NamingControl the Table Builder uses. null = the default, plain
  // numbers 1, 2, 3 (#855).
  id_pattern: string | null
  // per file column: target column_name in the existing Table, 'name' for
  // the Row ID (UPS-R4 — the file's own codes become the ids), or null (skip)
  mapping: (string | null)[]
  // UPS-R1/J1: the match key — a mapped target column (or 'name' for the Row
  // ID) that turns this run into an upsert. null = today's append-always.
  key: string | null
  // UPS-R3: what an empty mapped cell does to a matched row. Per run,
  // meaningful only when a key is set; keep is the default.
  empty_cells: 'keep' | 'clear'
  // UPS-R5: a remembered choice, never an active key until accepted.
  suggested: { key: string; empty_cells: 'keep' | 'clear' } | null
  // Failures carry sourceIndex — the row's 0-based position in the sheet's
  // data rows, blanks included (#115). The server's per-chunk `index` is
  // translated the moment a response lands and never stored. `skipped`
  // counts data rows with nothing in any mapped column: they are sent
  // nowhere, so IMP-I1's arithmetic is disclosed, not silently absorbed.
  check: {
    fields_updated?: number
    fields_kept?: number
    changed: number
    unchanged: number
    rows_kept: number
    conflicts: number
    tracks_changes?: boolean | null
    retired?: number
    valid: number
    updated: number
    inserted: number
    skipped: number
    // #201: a merge group's rows come from several sheets, so a failure has
    // to say WHICH — a row number is only true against its own sheet.
    failed: { sheetIndex: number; sourceIndex: number; message: string }[]
  } | null
  result: {
    updated: number
    inserted: number
    skipped: number
    failed: { sheetIndex: number; sourceIndex: number; message: string }[]
    // RVT-R1: the run identity this import was recorded under — what the
    // revert control addresses.
    run_id: string
  } | null
}

export interface ImportTarget {
  name: string
  columns: MappableColumn[]
}

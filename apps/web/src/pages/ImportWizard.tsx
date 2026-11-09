import { useEffect, useMemo, useRef, useState } from 'react'
import { tableHref } from 'shared'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
// (search read non-strictly: the wizard route lives in router.tsx, which
// imports this file — a strict useSearch would need the route object back)
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminPageTitle } from 'shared'
import { DEFAULT_ID_PATTERN, applyColumnCombines, autoMapImportColumns, choiceOptions, listColumnsInUse, retiredColumnNotice, coerceRows, splitForSend, combineOverlap, inferTableDef, mergeSheetHeaders, mergeSheetRows, scoreTableMatch, seriesPrefix, shouldAutoMatch, tableMatchQuality, tableNameFromFile, type ColumnCombine, type InferredTableDef, type TableMatchQuality } from 'shared'
import { ApiError, api, listResource } from '../lib/api'
import { ImportOverview, type GroupMode } from '../components/ImportOverview'
import { NamingControl } from '../components/NamingControl'
import { RevertControl, RunHistory } from '../components/ImportRunHistory'
import { SheetPreview } from '../components/ImportSheetPreview'
import { ImportPreviewFacts, KeySuggestions, UpsertPreview } from '../components/ImportUpsertPreview'
import { SUGGEST_MIN_SCORE, TargetPicker, TargetRowCount, fetchTargets } from '../components/ImportTargetPicker'
import { COLUMN_TYPES } from '../lib/meta'
import { refusalMessage } from '../lib/table-refusal'
import {
  countDataRows,
  excelRow,
  isImportableFile,
  parseWorkbook,
  type ParsedSheet,
} from '../lib/parse-file'
import { analyzeImportKeys, sendImportRun, type ImportUpsertArgs } from '../lib/import-run'
import {
  clearSession,
  loadDecisions,
  loadSheets,
  sameShape,
  saveDecisions,
  saveSheets,
  shapeOf,
  type ImportDecisions,
} from '../lib/import-session'
import type { SheetPlan } from '../lib/import-plan'
import { Notice, buttonClasses, cardClasses, inputClasses, labelClasses, pillClasses, touchLinkClasses } from '@featherbase/shop-floor'
import { fmtCount } from '@featherbase/shop-floor'

// #993: "1 row", never "1 rows".
const rowCount = (n: number) => `${fmtCount(n)} ${n === 1 ? 'row' : 'rows'}`

// #993: rows a Table made by an earlier attempt already holds. Importing again
// would double them, and nothing on the column step can fix that.
class HeldRowsError extends ApiError {}

/**
 * Type-to-confirm for an update run: the prompt shows the count with Indian
 * grouping (1,23,456), so the typed value matches with or without the commas.
 */
export function confirmsCount(typed: string, total: number): boolean {
  return typed.trim().replace(/,/g, '') === String(total)
}

// IMP-010: the Import wizard. Drop a CSV or a whole workbook; every sheet
// gets a target — a new Table (inferred, like the builder) or an existing
// one (columns auto-mapped by name/label; the suggestion itself is scored on
// column overlap, so a renamed file or sheet still finds its Table). Dry-run
// validates against the server before anything is written.

// UPS-H1 (owner decision 2026-08-11): beyond this many updates in one run,
// the count must be typed back — the preview is passive, typing 1,200 is not.
const CONFIRM_UPDATES_OVER = 20
const ERRORS_ON_SCREEN = 5 // failures listed inline; the log keeps more
// #738: a text-sized link in the grid header is thumb-tall at phone width
// even under a mouse, as touchLinkClasses makes it on any touch screen.
const PHONE_LINK = 'max-sm:inline-flex max-sm:min-h-touch max-sm:items-center'

// #738: which columns a new Table's list starts with. A column left out of
// the import (Use unticked) is never in the list.
function listTicks(plan: Pick<SheetPlan, 'include' | 'list_ticks'>): boolean[] {
  const own = plan.list_ticks?.length === plan.include.length ? plan.list_ticks : null
  return own ? own.map((on, i) => on && plan.include[i]) : listColumnsInUse(plan.include)
}

// A Choice of many options keeps its row one readable height; the rest are on hover.
const OPTIONS_SHOWN = 8
function optionsPreview(choices: string | undefined): string {
  const options = choices?.split('\n') ?? []
  const more = options.length - OPTIONS_SHOWN
  return options.slice(0, OPTIONS_SHOWN).join(', ') + (more > 0 ? ` +${more} more` : '')
}

// #1014: which of these ids are rows of the Table. Retired rows count: a link
// to one saves. The ids travel in a GET's address, which the server caps at
// about 16 KB, so a batch ends at the 500 rows one read returns or at 8 KB.
async function existingRowIds(table: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  let batch: string[] = []
  let size = 0
  const read = async () => {
    const { data } = await listResource<{ row_id: string }>(table, {
      filters: [['row_id', 'in', batch]],
      fields: ['row_id'],
      limit_page_length: 500,
      with_retired: true,
    })
    for (const row of data) found.add(String(row.row_id))
    batch = []
    size = 0
  }
  for (const id of ids) {
    const length = encodeURIComponent(JSON.stringify(id)).length + 3
    if (batch.length === 500 || (batch.length > 0 && size + length > 8000)) await read()
    batch.push(id)
    size += length
  }
  if (batch.length) await read()
  return found
}

export function ImportWizard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const search = useSearch({ strict: false }) as { table?: string }
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [sheets, setSheets] = useState<ParsedSheet[]>([])
  const [plans, setPlans] = useState<SheetPlan[]>([])
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // #203: what the whole run did — stated whenever it STOPS, not only when
  // every target succeeded, so a partial failure still reports and still
  // shows the way on.
  const [runOutcome, setRunOutcome] = useState<{
    imported: number
    failed: string[]
    remaining: number
    refused?: number
  } | null>(null)
  // #199: the wizard is two steps now. 'overview' answers "what is in this
  // file?"; 'columns' is the existing per-sheet work, over the chosen sheets
  // only. A CSV (one sheet) skips the overview — there is nothing to choose.
  const [stage, setStage] = useState<'overview' | 'columns'>('overview')
  // #200: which sheets are in. Empty on load, on purpose — including
  // everything by default is what created eleven unwanted Tables.
  const [selected, setSelected] = useState<boolean[]>([])
  const [ovRefused, setOvRefused] = useState(false)
  // #211: which columns are ticked for combining, keyed `${target}:${key}`
  // so two cards cannot collide. UI-only — the decision lands in the plan.
  const [combinePick, setCombinePick] = useState<Record<string, boolean>>({})
  const [combineName, setCombineName] = useState('')
  const [combineRule, setCombineRule] = useState<'first' | 'join'>('first')
  const [groupMode, setGroupMode] = useState<GroupMode>('separate')
  const [mergeName, setMergeName] = useState('')
  // #202: which target the column step is showing. Eleven cards stacked on
  // one screen is the wall this redesign started from, and it also left
  // nowhere to come back TO after looking at imported rows. Holds a PLAN
  // index rather than a position, so deselecting an earlier sheet cannot
  // silently slide the user onto a different target.
  const [current, setCurrent] = useState(0)
  // #993: the target card "Fix it" brought into view, outlined for a moment so
  // the press shows even when the card was already on screen.
  const [flash, setFlash] = useState<number | null>(null)
  const doneRef = useRef<HTMLParagraphElement>(null)
  // #204: decisions came back but the file's rows did not — too big for
  // sessionStorage, or a fresh tab. Everything the user DECIDED is intact;
  // only the data needs dropping again.
  const [needsFile, setNeedsFile] = useState<ImportDecisions<SheetPlan> | null>(null)
  // #326: a file dropped while saved work waits, that turned out not to be
  // that work's file. Held here, unread into the wizard, until the user picks.
  const [mismatch, setMismatch] = useState<File | null>(null)
  // #206: minted once per file read and carried by every part of every
  // target, so "which Tables came from that import?" has an answer.
  const [batchId, setBatchId] = useState('')
  // Whether this file's rows are being kept. Said up front, because
  // discovering it on return is exactly the surprise #204 exists to remove.
  const [dataKept, setDataKept] = useState(true)
  // The plan each sheet had when the file was read. Deselecting a sheet parks
  // it as 'skip'; reselecting must restore the target that was worked out for
  // it, not a blank one.
  const natural = useRef<SheetPlan[]>([])
  // UPS-H1's typed confirmation: set when a click-time dry run counted more
  // than CONFIRM_UPDATES_OVER changed rows; cleared by any plan change.
  // #202: `only` remembers the scope the confirmation was computed for — a
  // per-target run must not be confirmed into a run of everything.
  const [confirmUpdates, setConfirmUpdates] = useState<{
    total: number
    typed: string
    only?: number
    identity: string
  } | null>(null)
  const [appendWarning, setAppendWarning] = useState<{
    targets: { index: number; table: string; rows: number }[]
    acknowledged: boolean
    only?: number
    identity: string
  } | null>(null)

  // Consent belongs to these choices and this file, not to a cached preview.
  // Check results, remembered suggestions and transient errors are not choices.
  const guardIdentity = useMemo(() => JSON.stringify({
    fileName, batchId, sheets, selected,
    plans: plans.map(({ check, result, failure, suggested, ...choices }) => ({ ...choices, landed: !!result })),
  }), [fileName, batchId, sheets, selected, plans])
  const currentGuardIdentity = useRef(guardIdentity)
  currentGuardIdentity.current = guardIdentity
  useEffect(() => {
    setConfirmUpdates(null)
    setAppendWarning(null)
  }, [guardIdentity])

  // Every importable Table with its mappable columns — the mapping targets
  // and the corpus the rename-tolerant suggestions score against.
  const targets = useQuery({
    queryKey: ['import-targets'],
    queryFn: fetchTargets,
    staleTime: 60_000,
  })

  // #204: come back to what was left. Runs once — a later render must not
  // stamp saved state back over work done since.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const saved = loadDecisions<SheetPlan>()
    if (!saved) return
    setFileName(saved.fileName)
    setPlans(saved.plans)
    // An entry written by an older build may lack it; the plans themselves
    // are a safe stand-in for "what this sheet was worked out to be".
    natural.current = Array.isArray(saved.natural) ? saved.natural : saved.plans
    setSelected(saved.selected)
    setStage(saved.stage)
    setCurrent(saved.current)
    setBatchId(saved.batchId)
    setGroupMode(saved.groupMode)
    setMergeName(saved.mergeName)
    setRunOutcome(saved.outcome)
    setDone(saved.done)
    const rows = loadSheets(saved.fileName)
    if (rows) setSheets(rows)
    // No rows: the decisions stand and the file is asked for again, rather
    // than eleven Tables' worth of naming being thrown away because the data
    // was too big to carry.
    else setNeedsFile(saved)
  }, [])

  // Saved on a delay, because plans change on every keystroke in a column
  // name and a write per character is how this would come to feel broken.
  // The delay is why `pending` exists: leaving the page is precisely when the
  // save matters and precisely when a pending timer is about to be thrown
  // away, so the snapshot is always available to flush immediately.
  const pending = useRef<ImportDecisions<SheetPlan> | null>(null)
  useEffect(() => {
    // A finished run has nothing to resume, and resuming it would be actively
    // wrong: coming back to /admin/import is how you start the NEXT import,
    // and it is where the run-history strip lives. Only unfinished work is
    // worth carrying.
    // Nothing on screen — mid-load, or just cleared — is nothing to save.
    if (!fileName || done || (sheets.length === 0 && !needsFile)) {
      pending.current = null
      return
    }
    const snapshot: ImportDecisions<SheetPlan> = {
      fileName,
      batchId,
      stage,
      selected,
      plans,
      natural: natural.current,
      current,
      groupMode,
      mergeName,
      outcome: runOutcome,
      done,
      // While waiting for the file, `sheets` is empty — the saved shape is
      // what a re-drop is checked against, so it must not be overwritten
      // with the shape of nothing.
      shape: needsFile ? needsFile.shape : shapeOf(sheets),
    }
    pending.current = snapshot
    const timer = setTimeout(() => {
      // Only if this is still the live snapshot. A run that finishes clears
      // the session and nulls `pending`, but a timer scheduled a moment
      // earlier is already in flight — without this guard it lands AFTER the
      // clear and resurrects a session that is over.
      if (pending.current === snapshot) saveDecisions(snapshot)
    }, 400)
    return () => clearTimeout(timer)
  }, [
    fileName,
    batchId,
    stage,
    selected,
    plans,
    current,
    groupMode,
    mergeName,
    runOutcome,
    done,
    sheets,
    needsFile,
  ])

  // Write it out for real whenever this page is being left — a route change
  // (unmount), a reload, or the tab going away. Without this the debounce
  // would swallow the last edit in exactly the case #204 is about: clicking
  // through to the rows you just imported.
  useEffect(() => {
    const flush = () => {
      if (pending.current) saveDecisions(pending.current)
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  function fixTarget(i: number) {
    setCurrent(i)
    setFlash(i)
    requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(`[data-testid="iw-sheet-${i}"]`)
      card?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
      card?.focus({ preventScroll: true })
    })
    window.setTimeout(() => setFlash((f) => (f === i ? null : f)), 2000)
  }

  // #993: the outcome line sits just above the sticky Import bar, which can
  // cover it; bring it into view, clear of the bar, whenever it changes.
  useEffect(() => {
    if (runOutcome) doneRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [runOutcome])

  function startOver() {
    // Before clearing: a queued snapshot would otherwise be flushed back on
    // the way out and undo this.
    pending.current = null
    clearSession()
    setNeedsFile(null)
    setMismatch(null)
    setDataKept(true)
    setFileName(null)
    setSheets([])
    setPlans([])
    setSelected([])
    setStage('overview')
    setCurrent(0)
    setBatchId('')
    setRunOutcome(null)
    setDone(false)
    setError(null)
    natural.current = []
  }

  function setPlan(i: number, patch: Partial<SheetPlan>) {
    setPlans((ps) =>
      ps.map((p, j) => (j === i ? { ...p, ...patch, check: null, result: null, failure: null, failureAtPastImports: undefined } : p)),
    )
    // A changed plan invalidates a pending typed confirmation — its total
    // was computed for the previous mapping/key.
    setConfirmUpdates(null)
    setAppendWarning(null)
  }

  // `resumeFrom` is the saved work this file is meant to carry on; null reads
  // the file as a fresh import.
  async function loadFile(file: File, resumeFrom = needsFile) {
    setError(null)
    setDone(false)
    setMismatch(null)
    if (!isImportableFile(file.name)) {
      setError(`${file.name}: not a CSV or Excel file`)
      return
    }
    // #204: whatever was on screen is about to be replaced, and parsing is
    // async — so clear it NOW rather than leaving a restored grid live and
    // clickable for the moment it takes to read the file. Editing something
    // that is about to be thrown away is worse than a blank pause. Saved work
    // waiting for its file has no grid on screen, and stays until the file is
    // known to be the right one.
    setSheets([])
    if (!resumeFrom) setPlans([])
    try {
      const parsed = await parseWorkbook(file)
      // #326: a file that isn't the one the saved work is for must not
      // replace that work silently. Nothing is touched — not even the stored
      // rows — until the user says which to keep.
      if (resumeFrom && !sameShape(resumeFrom.shape, shapeOf(parsed))) {
        setMismatch(file)
        return
      }
      setNeedsFile(null)
      // A drop can beat the targets query; suggestions need the real corpus.
      const tables = await queryClient.ensureQueryData({
        queryKey: ['import-targets'],
        queryFn: fetchTargets,
      })
      setFileName(file.name)
      setSheets(parsed)
      // #204: the rows are kept if they fit. If they do not, say so now —
      // finding out on return that the file must be dropped again is the
      // surprise, not the dropping.
      setDataKept(saveSheets(file.name, parsed))
      // #206: a fresh read is a fresh batch. The resume path below puts the
      // original one back, so continuing an import stays ONE batch.
      setBatchId(crypto.randomUUID())
      // The same file, dropped again to carry on. Plans address sheets by
      // INDEX, so the shape check above is what makes this safe — otherwise a
      // saved mapping would quietly point at another sheet's columns. Name,
      // sheet names, headers and row counts all have to match.
      if (resumeFrom) {
        setPlans(resumeFrom.plans)
        natural.current = resumeFrom.natural
        setSelected(resumeFrom.selected)
        setStage(resumeFrom.stage)
        setCurrent(resumeFrom.current)
        setBatchId(resumeFrom.batchId)
        setGroupMode(resumeFrom.groupMode)
        setMergeName(resumeFrom.mergeName)
        setRunOutcome(resumeFrom.outcome)
        setDone(resumeFrom.done)
        return
      }
      const newPlans = parsed.map((sheet) => {
          const newName =
            (parsed.length === 1 ? tableNameFromFile(file.name) : tableNameFromFile(sheet.sheetName)) ||
            'Imported Table'
          const inferred = inferTableDef(newName, sheet.headers, sheet.rows)
          // Rename-tolerant suggestion: best column-overlap match, but
          // auto-selected only when the evidence is strong in BOTH
          // directions (shouldAutoMatch) — a small sheet fitting inside a
          // wider Table becomes a hint, not a silent default. ?table=X (the
          // list-view Import button) wins when it fits at all.
          let best: { name: string; q: TableMatchQuality; cols: number } | null = null
          for (const t of tables) {
            const q = tableMatchQuality(sheet.headers, t.columns)
            if (!best || q.score > best.q.score || (q.score === best.q.score && q.coverage > best.q.coverage))
              best = { name: t.name, q, cols: t.columns.length }
          }
          const pinned = search.table
            ? tables.find((t) => t.name === search.table)
            : undefined
          const pinnedScore = pinned ? scoreTableMatch(sheet.headers, pinned.columns) : 0
          const target =
            pinned && pinnedScore >= SUGGEST_MIN_SCORE
              ? pinned.name
              : best && shouldAutoMatch(newName, best.name, best.q)
                ? best.name
                : null
          const targetCols = tables.find((t) => t.name === target)?.columns ?? []
          const mapping = target ? autoMapImportColumns(target, sheet.headers, targetCols) : []
          return {
            mode: target ? 'existing' : 'new',
            table: target ?? newName,
            include: target ? mapping.map((m) => m !== null) : sheet.headers.map(() => true),
            auto_matched: Boolean(target),
            similar:
              !target && best && best.q.score >= 0.6
                ? { name: best.name, mapped: best.q.mapped, total: best.cols }
                : null,
            inferred,
            id_pattern: null,
            mapping,
            key: null,
            empty_cells: 'keep',
            suggested: null,
            check: null,
            result: null,
            members: [] as number[], // filled below, once the index is known
            groupedInto: null as number | null,
            combines: [] as ColumnCombine[],
            failure: null as string | null,
          } satisfies SheetPlan
        })
      // #200: remember what was worked out, then park every sheet. A single
      // sheet (any CSV) has nothing to choose, so it stays selected and the
      // overview is skipped entirely.
      // Every sheet starts as its own target; grouping is opt-in on the
      // overview. Done here rather than in the map above because a plan's
      // members are stated in sheet indices.
      newPlans.forEach((p, i) => {
        p.members = [i]
      })
      natural.current = newPlans
      const only = parsed.length === 1
      setGroupMode('separate')
      setMergeName(tableNameFromFile(file.name) || 'Imported Table')
      setSelected(parsed.map(() => only))
      setStage(only ? 'columns' : 'overview')
      setOvRefused(false)
      setPlans(only ? newPlans : newPlans.map((p) => ({ ...p, mode: 'skip' as const })))
      // UPS-R5: for sheets that landed on an existing Table, offer back that
      // Table's remembered match key — visibly, never silently.
      newPlans.forEach((p, i) => {
        if (p.mode === 'existing') void applySuggestion(i, p.table, p.mapping)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file')
    }
  }

  // #200: selecting a sheet restores the target worked out at load; clearing
  // it parks the sheet as 'skip', which every downstream step already honours.
  function applySelection(next: boolean[]) {
    setSelected(next)
    setOvRefused(false)
    setPlans((ps) =>
      ps.map((p, i) =>
        next[i]
          ? p.mode === 'skip'
            ? { ...(natural.current[i] ?? p), check: null, result: null, members: [i], groupedInto: null }
            : { ...p, check: null, result: null, members: [i], groupedInto: null }
          : { ...p, mode: 'skip' as const, check: null, result: null, members: [i], groupedInto: null },
      ),
    )
  }

  // #201: the merged column set for a group — every member's headers folded
  // together and their rows projected onto the result. One sheet's group is
  // just that sheet, so this is the single path both cases take.
  function mergedColumnsFor(plan: SheetPlan) {
    return applyColumnCombines(
      mergeSheetHeaders(plan.members.map((m) => sheets[m].headers)),
      plan.combines,
    )
  }

  // A group behaves like one sheet from here on: same shape, so the grid, the
  // mapping, the type inference and the coercion all read it unchanged.
  function effectiveSheet(plan: SheetPlan, i: number): ParsedSheet {
    if (plan.members.length < 2) return sheets[i]
    const cols = mergedColumnsFor(plan)
    return {
      sheetName: plan.table,
      headers: cols.map((c) => c.label),
      rows: mergeSheetRows(cols, plan.members.map((m) => sheets[m].rows)),
      headerExcelRow: 1,
      visibility: 'visible',
    }
  }

  // One member's rows projected onto the GROUP's column order, so they line
  // up with plan.inferred.columns — while keeping the member's own name and
  // headerExcelRow, which is what makes a failed row's number true (#115).
  function memberSheet(plan: SheetPlan, m: number): ParsedSheet {
    if (plan.members.length < 2) return sheets[m]
    const cols = mergedColumnsFor(plan)
    return {
      sheetName: sheets[m].sheetName,
      headers: cols.map((c) => c.label),
      rows: mergeSheetRows(
        cols,
        plan.members.map((mm) => (mm === m ? sheets[mm].rows : [])),
      ),
      headerExcelRow: sheets[m].headerExcelRow,
      visibility: sheets[m].visibility,
    }
  }

  // #211: changing a combine changes the column SET, so the inferred
  // definition and the include flags are rebuilt from it. Type inference runs
  // over the combined values — a column made of `Store Code` and
  // `Store Name` is Data even where each source alone might have read as
  // something narrower.
  function setCombines(i: number, combines: ColumnCombine[]) {
    setPlans((ps) =>
      ps.map((p, j) => {
        if (j !== i) return p
        const next = { ...p, combines }
        const cols = mergedColumnsFor(next)
        const rows = mergeSheetRows(cols, next.members.map((m) => sheets[m].rows))
        const fresh = inferTableDef(next.table, cols.map((c) => c.label), rows)
        // A column this combine leaves alone keeps what the person set on it.
        const before = mergedColumnsFor(p)
        const untouched = (ci: number) => (cols[ci].combinedKeys ? -1 : before.findIndex((b) => b.key === cols[ci].key && !b.combinedKeys))
        const inferred = { ...fresh, columns: fresh.columns.map((c, ci) => p.inferred.columns[untouched(ci)] ?? c) }
        return { ...next, inferred, include: inferred.columns.map((_, ci) => p.include[untouched(ci)] ?? true), list_ticks: undefined, check: null, result: null }
      }),
    )
  }

  function leaveOverview() {
    const chosen = selected.flatMap((on, i) => (on ? [i] : []))
    if (!chosen.length) {
      setOvRefused(true)
      return
    }
    // #201: fold the chosen sheets into one target, or leave them as one
    // target each. The lead is the first chosen sheet; the rest point at it.
    if (groupMode === 'merge' && chosen.length >= 2) {
      const lead = chosen[0]
      const name = mergeName.trim() || 'Imported Table'
      const cols = mergeSheetHeaders(chosen.map((m) => sheets[m].headers))
      const rows = mergeSheetRows(cols, chosen.map((m) => sheets[m].rows))
      const inferred = inferTableDef(name, cols.map((c) => c.label), rows)
      setPlans((ps) =>
        ps.map((p, i) =>
          i === lead
            ? {
                ...p,
                mode: 'new' as const,
                table: name,
                members: chosen,
                groupedInto: null,
                combines: [],
                failure: null,
                inferred,
                include: inferred.columns.map(() => true),
                list_ticks: undefined,
                auto_matched: false,
                similar: null,
                mapping: [],
                key: null,
                suggested: null,
                check: null,
                result: null,
              }
            : chosen.includes(i)
              ? { ...p, groupedInto: lead, members: [i], check: null, result: null }
              : p,
        ),
      )
    }
    setStage('columns')
    // Start at the first target every time the overview is left, so
    // "← Choose sheets", change the selection, continue lands somewhere that
    // exists rather than on a card that is now skipped.
    setCurrent(chosen[0])
  }

  function retarget(i: number, value: string) {
    const sheet = sheets[i]
    if (value === '__new__') {
      const fallback =
        (sheets.length === 1 ? tableNameFromFile(fileName ?? '') : tableNameFromFile(sheet.sheetName)) ||
        'Imported Table'
      setPlan(i, {
        mode: 'new',
        table: fallback,
        auto_matched: false,
        mapping: [],
        key: null,
        suggested: null,
        include: sheet.headers.map(() => true),
        list_ticks: undefined,
      })
      return
    }
    const cols = targets.data?.find((t) => t.name === value)?.columns ?? []
    const mapping = autoMapImportColumns(value, sheet.headers, cols)
    setPlan(i, {
      mode: 'existing',
      table: value,
      auto_matched: false,
      similar: null,
      mapping,
      key: null,
      empty_cells: 'keep',
      suggested: null,
      include: mapping.map((m) => m !== null),
    })
    void applySuggestion(i, value, mapping)
  }

  // UPS-R5: read the remembered choice, without activating it. KeySuggestions
  // validates it against the current mapped rows and server permissions.
  // A reader without an Import Log grant simply gets no remembered suggestion.
  async function applySuggestion(i: number, forTable: string, map: (string | null)[]) {
    try {
      const logs = await api.get<{ data: { key_column: string | null; empty_cells: string | null }[] }>(
        `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
          '["key_column","empty_cells"]',
        )}&filters=${encodeURIComponent(
          JSON.stringify([['ref_table', '=', forTable]]),
        )}&order_by=${encodeURIComponent('created_at desc')}&limit_page_length=20`,
      )
      const last = logs.data.find((l) => l.key_column)
      if (!last?.key_column) return
      const key = last.key_column
      // Only offerable if this file still maps that column (or the Row ID).
      if (!map.includes(key)) return
      const empty_cells = last.empty_cells === 'clear' ? 'clear' : 'keep'
      setPlans((ps) =>
        ps.map((p, j) =>
          j === i && p.mode === 'existing' && p.table === forTable && p.mapping.length === map.length && p.mapping.every((m, idx) => m === map[idx])
            ? { ...p, suggested: { key, empty_cells } }
            : p,
        ),
      )
    } catch {
      // No read on Import Log — no remembered suggestion. Value-derived
      // analysis is separate and its errors are shown, never treated as no overlap.
    }
  }

  // Rows for an existing-Table plan: project the mapped file columns and
  // coerce cells to the target column types.
  function mappedRows(sheet: ParsedSheet, plan: SheetPlan) {
    const cols = targets.data?.find((t) => t.name === plan.table)?.columns ?? []
    const typeOf = new Map(cols.map((c) => [c.column_name, c.column_type]))
    const picks = plan.mapping
      .map((target, idx) => (target && plan.include[idx] ? { idx, target } : null))
      .filter((p): p is { idx: number; target: string } => p !== null)
    return coerceRows(
      picks.map((p) => ({ column_name: p.target, column_type: typeOf.get(p.target) ?? 'Data' })),
      sheet.rows.map((r) => picks.map((p) => r[p.idx])),
    )
  }

  // #416: a refused column is named by the sheet's header that feeds it, so
  // the message points at a column the user can find in their own file.
  function headerLabel(sheet: ParsedSheet, plan: SheetPlan) {
    return (column: string) => {
      const idx = plan.mapping.findIndex((target, i) => target === column && plan.include[i])
      return idx >= 0 && sheet.headers[idx] ? String(sheet.headers[idx]) : column
    }
  }

  function planIdPattern(plan: SheetPlan): string {
    return plan.id_pattern ?? DEFAULT_ID_PATTERN
  }

  // The mapped target columns of an existing-mode run — the `columns` the
  // server needs so UPS-R3's 'clear' knows which absent cells were
  // mapped-but-empty rather than simply unmapped.
  function mappedTargets(plan: SheetPlan): string[] {
    return [
      ...new Set(
        plan.mapping.filter((m, idx): m is string => m !== null && plan.include[idx]),
      ),
    ]
  }

  // Rows for a new-Table plan: 1:1 with the inferred (possibly renamed)
  // columns; blank-named and unchecked columns are dropped.
  function newTableRows(sheet: ParsedSheet, plan: SheetPlan) {
    const picks = plan.inferred.columns
      .map((c, idx) => (c.column_name.trim() && plan.include[idx] ? { idx, c } : null))
      .filter((p): p is { idx: number; c: (typeof plan.inferred.columns)[number] } => p !== null)
    return coerceRows(
      picks.map((p) => ({ column_name: p.c.column_name.trim(), column_type: p.c.column_type })),
      sheet.rows.map((r) => picks.map((p) => r[p.idx])),
    )
  }

  // A column's type, as the person picked it. Inference fills a Choice's options
  // only when it picks Choice itself, and a Choice with none is refused, so a
  // hand-picked one reads them from every sheet feeding the column.
  function withColumnType(plan: SheetPlan, column: InferredTableDef['columns'][number], ci: number, column_type: string) {
    if (column_type !== 'Choice' || column.choices) return { ...column, column_type }
    const values = plan.members.flatMap((m) => memberSheet(plan, m).rows.map((row) => row[ci]))
    return { ...column, column_type, choices: choiceOptions(values).join('\n') || undefined }
  }

  // The columns a new Table is made with, each with its place on screen, so a
  // refusal can name the one the person sees.
  function sentColumns(plan: SheetPlan) {
    return plan.inferred.columns
      .map((c, sourceIndex) => ({ ...c, sourceIndex }))
      .filter((c) => c.column_name.trim() && plan.include[c.sourceIndex])
  }

  // #1014: the columns of a new Table that link to another Table, with their
  // file values' row problems found by reading the target through the server.
  function linkColumns(plan: SheetPlan) {
    return plan.mode === 'new' ? sentColumns(plan).filter((c) => c.column_type === 'Reference') : []
  }

  // Rehearse a new Table's links. The Table does not exist yet, so the server's
  // import has nothing to rehearse against; a link is only ever its target's row
  // id (validateLinks), so a value is good exactly when that row id exists.
  async function linkProblems(plan: SheetPlan, parts: ReturnType<typeof targetParts>) {
    const problems = new Map<string, string[]>()
    for (const link of linkColumns(plan)) {
      const column = link.column_name.trim()
      const values = [...new Set(parts.flatMap((p) => p.rows.map((r) => r.values[column])).filter((v) => v != null && v !== '').map(String))]
      const found = await existingRowIds(link.reference_table!, values)
      for (const part of parts)
        for (const row of part.rows) {
          const value = row.values[column]
          if (value == null || value === '' || found.has(String(value))) continue
          const key = `${part.sheetIndex}:${row.sourceIndex}`
          problems.set(key, [...(problems.get(key) ?? []), `"${String(value)}" is not a row of ${link.reference_table}. Links match a row's ID, not its name`])
        }
    }
    return problems
  }

  // Make the Table a new-Table plan imports into. On a second attempt the first
  // may have made it already: an empty one is made again, since the person may
  // have changed its columns since, and one holding rows would double them.
  async function makeNewTable(plan: SheetPlan, i: number) {
    if (plan.created_table === plan.table) {
      const address = encodeURIComponent(plan.table)
      const held = await api.get<{ count: number }>(`/api/table/${address}:count`).catch(() => null)
      if (held?.count)
        throw new HeldRowsError(409, 'ConflictError', `${plan.table} already holds ${rowCount(held.count)} from the attempt that stopped. Delete it under Past imports, then import again.`)
      if (held) await api.delete(`/api/table_def/${address}`)
    }
    const inList = listTicks(plan)
    await api.post('/api/table_def', {
      name: plan.table,
      id_pattern: planIdPattern(plan),
      columns: sentColumns(plan).map((c) => ({
        column_name: c.column_name.trim(),
        label: c.label.trim() || undefined,
        column_type: c.column_type,
        choices: c.column_type === 'Choice' ? c.choices : undefined,
        reference_table: c.column_type === 'Reference' ? c.reference_table : undefined,
        in_list_view: inList[c.sourceIndex],
      })),
    }).catch((err: unknown) => {
      // #993: say what to do about a name that is taken, not only that it is.
      if (err instanceof ApiError && err.type === 'ConflictError')
        throw new ApiError(err.status, err.type, `${err.message}. Give the new Table another name, or pick that Table under “Import into” to add the rows to it.`)
      throw err
    })
    setPlans((ps) => ps.map((p, j) => (j === i ? { ...p, created_table: plan.table } : p)))
  }

  // The upsert arguments of an existing-mode run, or null for append-always.
  function upsertArgs(plan: SheetPlan): ImportUpsertArgs | null {
    if (!plan.key) return null
    return {
      key_column: plan.key,
      empty_cells: plan.empty_cells,
      columns: mappedTargets(plan),
    }
  }

  // Gate keys across the entire target before sending any member, but keep
  // each row's sheet and source index for Check, failures and Import Logs.
  function targetParts(plan: SheetPlan) {
    const parts = plan.members.map((sheetIndex) => {
      const sheet = memberSheet(plan, sheetIndex)
      const rows = plan.mode === 'new' ? newTableRows(sheet, plan) : mappedRows(sheet, plan)
      return { sheetIndex, rows, skipped: countDataRows(sheets[sheetIndex].rows) - rows.length }
    })
    const all = parts.flatMap((p) => p.rows).map((row, sourceIndex) => ({ ...row, sourceIndex }))
    const duplicates = new Map(splitForSend(all, plan.mode === 'existing' ? plan.key : null)
      .dupFailed.map((f) => [f.sourceIndex, f.message]))
    let offset = 0
    return parts.map((part) => {
      const failed: { sheetIndex: number; sourceIndex: number; message: string }[] = []
      const rows = part.rows.filter((row, index) => {
        const message = duplicates.get(offset + index)
        if (!message) return true
        failed.push({ sheetIndex: part.sheetIndex, sourceIndex: row.sourceIndex, message })
        return false
      })
      offset += part.rows.length
      return { ...part, rows, failed }
    })
  }

  // #202: the Check button rehearses the active existing-Table target.
  async function runCheck(only: number) {
    setError(null)
    setBusy('Checking…')
    try {
      for (const [i, plan] of plans.entries()) {
        if (i !== only) continue
        // #201: rehearse member by member, exactly as the import will send
        // them, so a reported row number is true against its own sheet.
        const totals = { valid: 0, updated: 0, changed: 0, unchanged: 0, inserted: 0, skipped: 0, fields_updated: 0, fields_kept: 0, rows_kept: 0, conflicts: 0, retired: 0, tracks_changes: null as boolean | null }
        const failed: { sheetIndex: number; sourceIndex: number; message: string }[] = []
        if (plan.mode === 'new') {
          const parts = targetParts(plan)
          const problems = await linkProblems(plan, parts)
          for (const part of parts) {
            totals.skipped += part.skipped
            failed.push(...part.failed)
            for (const row of part.rows) {
              const message = problems.get(`${part.sheetIndex}:${row.sourceIndex}`)
              if (message) failed.push({ sheetIndex: part.sheetIndex, sourceIndex: row.sourceIndex, message: message.join('; ') })
              else totals.valid++
            }
          }
          setPlans((ps) => ps.map((p, j) => (j === i ? { ...p, check: { ...totals, failed } } : p)))
          continue
        }
        for (const { sheetIndex: m, rows, skipped, failed: duplicates } of targetParts(plan)) {
          const sheet = memberSheet(plan, m)
          // IMP-I1 disclosure: data rows with nothing in any MAPPED column
          // are sent nowhere — say so instead of letting the counts quietly
          // disagree with the file.
          totals.skipped += skipped
          failed.push(...duplicates)
          if (!rows.length) continue
          const report = await sendImportRun({
            table: plan.table,
            rows,
            dryRun: true,
            upsert: upsertArgs(plan),
            columnLabel: headerLabel(sheet, plan),
          })
          totals.fields_updated += report.fields_updated
          totals.fields_kept += report.fields_kept
          totals.changed += report.changed
          totals.unchanged += report.unchanged
          totals.rows_kept += report.rows_kept
          totals.conflicts += report.conflicts
          totals.retired += report.retired
          totals.tracks_changes = report.tracks_changes
          totals.valid += report.valid
          totals.updated += report.updated
          totals.inserted += report.inserted
          failed.push(...report.failed.map((f) => ({ ...f, sheetIndex: m })))
        }
        failed.sort((a, b) => plan.members.indexOf(a.sheetIndex) - plan.members.indexOf(b.sheetIndex) || a.sourceIndex - b.sourceIndex)
        setPlans((ps) => ps.map((p, j) => (j === i ? { ...p, check: { ...totals, failed } } : p)))
      }
    } catch (err) {
      setError(refusalMessage(err, 'Check failed'))
    } finally {
      setBusy(null)
    }
  }

  // #202: `only` imports a single target, so an eleven-sheet workbook is a
  // sequence of small commits rather than one all-or-nothing run. Omitted, it
  // imports every target that has not landed yet.
  async function runImport(only?: number) {
    setError(null)
    setRunOutcome(null)
    setPlans((ps) =>
      ps.map((p, j) => (only === undefined || j === only ? { ...p, failure: null, failureAtPastImports: undefined } : p)),
    )
    setBusy('Importing…')
    try {
      // Recheck on EVERY click, including acknowledgement and typed-count
      // acceptance. No preview or previous confirmation reserves stored rows.
      let changes = 0
      const overlaps: { index: number; table: string; rows: number }[] = []
      for (const [i, plan] of plans.entries()) {
        if (only !== undefined && i !== only) continue
        if (only === undefined && plan.result) continue
        if (plan.mode !== 'existing' || plan.groupedInto !== null) continue
        const rows = mappedRows(effectiveSheet(plan, i), plan)
        if (!rows.length) continue
        try {
          if (plan.key) {
            const report = await sendImportRun({
              table: plan.table,
              rows,
              dryRun: true,
              upsert: upsertArgs(plan),
            })
            changes += report.changed
          } else {
            const candidates = await analyzeImportKeys({ table: plan.table, columns: mappedTargets(plan), rows })
            if (candidates.some((c) => c.complete)) overlaps.push({ index: i, table: plan.table, rows: rows.length })
          }
        } catch (err) {
          const message = refusalMessage(err, 'Import safety check failed')
          if (currentGuardIdentity.current === guardIdentity)
            setPlans((ps) => ps.map((p, j) => j === i ? { ...p, failure: message } : p))
          throw err // Failed analysis is never permission to append or write other targets.
        }
      }
      if (currentGuardIdentity.current !== guardIdentity) {
        setError('Import choices changed while checking. Import again to check the current choices.')
        return
      }
      const appendAccepted = appendWarning?.identity === guardIdentity && appendWarning.only === only &&
        appendWarning.acknowledged && JSON.stringify(appendWarning.targets) === JSON.stringify(overlaps)
      if (overlaps.length && !appendAccepted) {
        setAppendWarning({ targets: overlaps, acknowledged: false, only, identity: guardIdentity })
        setConfirmUpdates(null)
        return
      }
      if (changes > CONFIRM_UPDATES_OVER && !(confirmUpdates?.identity === guardIdentity &&
        confirmUpdates.only === only && confirmUpdates.total === changes && confirmsCount(confirmUpdates.typed, changes))) {
        setConfirmUpdates({ total: changes, typed: '', only, identity: guardIdentity })
        return
      }
      setConfirmUpdates(null)
      setAppendWarning(null)
      // #203: a target's failure belongs to THAT target. The loop used to sit
      // inside one try, so a throw on sheet 2 left sheets 3..n unattempted and
      // unreported, and skipped the completion block — taking with it the only
      // link to the Import Log. Each target now fails on its own.
      let imported = 0
      let rowsRefused = 0
      const failedTargets: string[] = []
      const ran: number[] = []
      for (const [i, plan] of plans.entries()) {
        if (plan.mode === 'skip' || plan.groupedInto !== null) continue
        if (only !== undefined && i !== only) continue
        // #202: a bulk run picks up where the stepper left off. Re-importing
        // a target that already landed would duplicate its rows, and the
        // result on screen is the user's evidence that it did land.
        if (only === undefined && plan.result) continue
        try {
        if (plan.mode === 'new') await makeNewTable(plan, i)
        // RVT-R1: one identity for the whole target, shared by its parts —
        // the handle the revert control addresses. #201: for a merge group
        // that means one run_id across every member sheet, so reverting
        // takes back all of them together.
        const runId = crypto.randomUUID()
        // #201: send a part PER MEMBER SHEET rather than one blended batch.
        // The Import Log already records sheet_name per part, and a failed
        // row's number is only true against the sheet it came from — both
        // are lost the moment members are concatenated.
        const total = { updated: 0, inserted: 0, skipped: 0 }
        const failed: { sheetIndex: number; sourceIndex: number; message: string }[] = []
        // Stamped on the FIRST PART ACTUALLY SENT for this target, not on
        // member 0: a member whose projected rows are all blank is skipped
        // before any log request (header-only sheets parse fine), so keying
        // the flag to the member index loses the fact that the import made
        // the Table — and Past imports then calls it pre-existing and will
        // not offer to delete it.
        let creationStamped = false
        for (const { sheetIndex: m, rows, skipped, failed: duplicates } of targetParts(plan)) {
          const sheet = sheets[m]
          total.skipped += skipped
          failed.push(...duplicates)
          if (!rows.length) continue
          const report = await sendImportRun({
            table: plan.table,
            rows,
            upsert: plan.mode === 'existing' ? upsertArgs(plan) : null,
            columnLabel: plan.mode === 'existing' ? headerLabel(memberSheet(plan, m), plan) : undefined,
            // IMP-011: recorded in the Import Log alongside the counts.
            context: (part, parts) => ({
              file_name: fileName ?? undefined,
              sheet_name: sheet.sheetName,
              table_created: plan.mode === 'new' && !creationStamped && part === 1,
              part,
              parts,
              run_id: runId,
              batch_id: batchId,
            }),
            onChunk: ({ from, to, total: n }) =>
              setBusy(
                `${plan.table}${plan.members.length > 1 ? ` · ${sheet.sheetName}` : ''}: importing rows ${from}–${to} of ${n}…`,
              ),
          })
          creationStamped = true
          total.updated += report.updated
          total.inserted += report.inserted
          failed.push(...report.failed.map((f) => ({ ...f, sheetIndex: m })))
        }
        failed.sort((a, b) => plan.members.indexOf(a.sheetIndex) - plan.members.indexOf(b.sheetIndex) || a.sourceIndex - b.sourceIndex)
        // Every row refused into a Table made for them: nothing landed, and its
        // columns may be why. So this target failed, and can be corrected and
        // imported again rather than leaving an empty Table with the wrong columns.
        if (plan.mode === 'new' && failed.length && !total.inserted && !total.updated)
          throw new ApiError(417, 'ValidationError', `${failed.length === 1 ? 'the 1 row was' : `all ${fmtCount(failed.length)} rows were`} refused (first: ${failLabel(plan, failed[0])})`)
        rowsRefused += failed.length
        setPlans((ps) =>
          ps.map((p, j) =>
            j === i
              ? { ...p, result: { ...total, failed, run_id: runId } }
              : p,
          ),
        )
        imported += 1
        ran.push(i)
        } catch (err) {
          // Recorded, named, and the run continues. A target that threw is
          // not the same as one that imported nothing, so it says which.
          failedTargets.push(plan.table)
          const message = refusalMessage(err, 'Import failed', plan.mode === 'new' ? sentColumns(plan) : [])
          const atPastImports = err instanceof HeldRowsError
          setPlans((ps) =>
            ps.map((p, j) => (j === i ? { ...p, failure: message, failureAtPastImports: atPastImports } : p)),
          )
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['tables'] })
      await queryClient.invalidateQueries({ queryKey: ['import-targets'] })
      // #203: `done` retires the Import button, so it must not latch on a
      // partial failure — the whole point is that the run can be fixed and
      // tried again without starting over.
      // #202: and it must not latch on a per-target run either. Targets 2..n
      // are still to come; `plans` here predates this run, so what landed in
      // it is `ran` rather than anything readable off a plan.
      const landed = (j: number) => ran.includes(j) || Boolean(plans[j]?.result)
      const activeIndexes = plans.flatMap((p, j) =>
        p.mode !== 'skip' && p.groupedInto === null ? [j] : [],
      )
      const stillToGo = activeIndexes.filter((j) => !landed(j)).length
      // #202: "Import complete." after target 1 of 3 would be a lie. The run
      // still always reports when it STOPS (#203) — it just reports what it
      // actually did and what is left.
      setRunOutcome({ imported, failed: failedTargets, remaining: stillToGo, refused: rowsRefused })
      const finished = failedTargets.length === 0 && activeIndexes.every(landed)
      setDone(finished)
      // #204: and drop the saved session with it, so the next visit is a
      // clean wizard rather than a re-run of one that is over.
      if (finished) {
        pending.current = null
        clearSession()
      }
      // #202: walk on to the first target still waiting. Staying put after a
      // per-target import would make the next one a hunt; jumping past
      // something unimported would skip it silently.
      if (only !== undefined && !failedTargets.length) {
        const next = activeIndexes.find((j) => !landed(j))
        if (next !== undefined) setCurrent(next)
      }
      const active = plans.filter((p) => p.mode !== 'skip' && p.groupedInto === null)
      // Auto-navigation exists because a lone sheet leaves nothing else to
      // look at. #201: a merge group is one target but many sheets, and its
      // result is a per-sheet summary with ONE revert control for the whole
      // group — jumping to the list view would destroy the only place either
      // can be read, which is the complaint this work started from.
      // #203: and never navigate away from a failure the user has not read,
      // refused rows included: they are listed nowhere else on the way out.
      if (!failedTargets.length && !rowsRefused && active.length === 1 && active[0].members.length === 1) {
        navigate({
          to: '/featherbase/admin/table/$table',
          params: { table: active[0].table },
          search: { filters: undefined },
        })
      }
    } catch (err) {
      setError(refusalMessage(err, 'Import failed'))
    } finally {
      setBusy(null)
    }
  }

  // #202: the targets the column step walks — a chosen sheet, or a merge
  // group standing for several. Followers and skipped sheets are not targets.
  const targetIndexes = plans.flatMap((p, i) =>
    p.mode !== 'skip' && p.groupedInto === null ? [i] : [],
  )
  // `current` can name a sheet that has since been deselected or folded into
  // a group; falling back to the first target keeps the step renderable
  // rather than blank.
  const currentPos = targetIndexes.indexOf(current)
  const activePos = currentPos === -1 ? 0 : currentPos
  const activeTarget = targetIndexes[activePos] ?? -1
  const activePlan = plans[activeTarget]
  const landedCount = targetIndexes.filter((i) => plans[i]?.result).length
  const anyChecked = plans.some((p) => p.check)
  const blockingProblems = plans.reduce((n, p) => n + (p.check?.failed.length ?? 0), 0)
  // #1014: a link column can't be made without its Table, so Import waits for it.
  const unpickedOf = (i: number) => (plans[i] ? linkColumns(plans[i]).filter((c) => !c.reference_table) : [])
  const unpickedLinks = targetIndexes.filter((i) => !plans[i]?.result).flatMap((i) =>
    unpickedOf(i).map((c) => `${c.label || c.column_name}${targetIndexes.length > 1 ? ` (in ${plans[i].table})` : ''}`),
  )
  const activeUnpicked = unpickedOf(activeTarget)

  // What a step is called. A group is named by the Table it will become —
  // no one member's sheet name speaks for it.
  function targetLabel(i: number): string {
    const plan = plans[i]
    if (plan.members.length > 1) return plan.table || 'Merged Table'
    return sheets[i]?.sheetName || plan.table
  }

  // Rows this one target will send, for its own Import button.
  function targetRows(i: number): number {
    const plan = plans[i]
    return plan.members.reduce((n, m) => n + countDataRows(sheets[m]?.rows ?? []), 0)
  }

  // A failed row's number is only true against the sheet it came from, so a
  // group says which sheet.
  function failLabel(
    plan: SheetPlan,
    f: { sheetIndex: number; sourceIndex: number; message: string },
  ): string {
    const from = sheets[f.sheetIndex]
    if (!from) return f.message
    const where = plan.members.length > 1 ? `${from.sheetName} row` : 'row'
    return `${where} ${excelRow(f.sourceIndex, from.headerExcelRow)}: ${f.message}`
  }

  return (
    <div data-testid="import-wizard" className="max-w-4xl">
      <h1 className="mb-4 text-xl font-semibold text-ink">{adminPageTitle('import')}</h1>

      <div
        data-testid="iw-dropzone"
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files[0]
          if (file) void loadFile(file)
        }}
        className={`mb-4 cursor-pointer rounded-md border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${
          dragging
            ? 'border-action bg-action-tint text-action'
            : 'border-border-control text-ink-muted hover:border-action'
        }`}
      >
        {fileName && needsFile ? (
          <span data-testid="iw-file-name">
            Drop <strong>{fileName}</strong> again to carry on
          </span>
        ) : fileName ? (
          <span data-testid="iw-file-name">
            <strong>{fileName}</strong> — {sheets.length} sheet{sheets.length === 1 ? '' : 's'}
          </span>
        ) : (
          <>Drag & drop a CSV or Excel workbook here — every sheet becomes an import — or click to browse</>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.xlsx,.xlsm,.xls"
          data-testid="iw-file-input"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void loadFile(file)
          }}
        />
      </div>

      {/* #204: what was decided outlived the page; the rows did not. Say
          exactly what is being held and what is needed, because a wizard that
          simply reopens empty is what sent the owner here. */}
      {needsFile && (
        <div
          className="mb-3 rounded border border-action bg-action-tint px-3 py-2 text-sm"
          data-testid="iw-resume"
        >
          <strong>Your work on {needsFile.fileName} is saved.</strong>{' '}
          {needsFile.plans.filter((p) => p.mode !== 'skip' && p.groupedInto === null).length} Tables
          planned
          {needsFile.plans.some((p) => p.result) &&
            `, ${needsFile.plans.filter((p) => p.result).length} already imported`}
          . The file itself is not kept in the browser — drop the same file above and it picks up
          where you left off.
          <button
            type="button"
            className="ml-2 underline"
            data-testid="iw-start-over"
            onClick={startOver}
          >
            Start over instead
          </button>
        </div>
      )}

      {/* #326: the file dropped isn't the saved work's file. Replacing that
          work is the user's call, made here, never a side effect of a drop. */}
      {/* The live region is on the page before the warning goes into it:
          a status that arrives together with its text is often not read out. */}
      {needsFile && (
        <div aria-live="polite">
          {mismatch && (
            <div className="mb-3" data-testid="iw-mismatch">
              <Notice tone="caution">
                <strong>
                  {mismatch.name === needsFile.fileName
                    ? `This copy of ${mismatch.name} isn't the one your saved work is for.`
                    : `${mismatch.name} isn't the file your saved work is for.`}
                </strong>{' '}
                Your work on {needsFile.fileName} (
                {needsFile.plans.filter((p) => p.mode !== 'skip' && p.groupedInto === null).length} Tables
                planned
                {needsFile.plans.some((p) => p.result) &&
                  `, ${needsFile.plans.filter((p) => p.result).length} already imported`}
                ) is still saved. This file's sheets, headings or row counts don't match it.
                <span className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={buttonClasses({ variant: 'primary', className: 'py-1' })}
                    data-testid="iw-mismatch-replace"
                    onClick={() => {
                      const file = mismatch
                      startOver()
                      void loadFile(file, null)
                    }}
                  >
                    {mismatch.name === needsFile.fileName
                      ? 'Import this copy instead'
                      : `Import ${mismatch.name} instead`}
                  </button>
                  <button
                    type="button"
                    className={buttonClasses({ className: 'py-1' })}
                    data-testid="iw-mismatch-keep"
                    onClick={() => setMismatch(null)}
                  >
                    Keep my saved work
                  </button>
                </span>
              </Notice>
            </div>
          )}
        </div>
      )}

      {/* Said BEFORE leaving the page, not discovered on returning to it. */}
      {!dataKept && sheets.length > 0 && (
        <p className="mb-3 text-xs text-ink-muted" data-testid="iw-too-big">
          This workbook is too large to keep in the browser. Your choices are saved, but if you
          leave this page you will need to drop the file again.
        </p>
      )}

      {fileName && !needsFile && (
        <p className="mb-3 text-xs text-ink-muted">
          <button
            type="button"
            className="underline"
            data-testid="iw-start-over"
            onClick={startOver}
          >
            Start over
          </button>
          {' — forget this file and every choice made about it.'}
        </p>
      )}

      {search.table && sheets.length === 0 && <RunHistory table={search.table} />}

      {/* #205: the only link to the Import Log used to live inside the
          completion block, which renders only when NOTHING failed — so the
          one situation where the log matters most was the one that hid it.
          It is present from the moment a file is loaded, and after. */}
      <p className="mb-3 text-xs text-ink-muted">
        <Link
          to="/featherbase/admin/table/$table"
          params={{ table: 'Import Log' }}
          search={{ filters: undefined }}
          className="underline"
          data-testid="iw-history-link"
        >
          View import history
        </Link>
        {' — every import that has run, with what it created and how to undo it. '}
        {/* #206: the log is run-by-run; this is import-by-import, which is
            what "which Tables came from that file?" actually asks. */}
        <Link to="/featherbase/admin/imports" className="underline" data-testid="iw-batches-link">
          Past imports
        </Link>
        {' — grouped by the file they came from.'}
      </p>

      {/* #199: the overview owns the whole screen while it is up — showing
          column grids underneath it would be the wall of controls it exists
          to replace. */}
      {stage === 'overview' && sheets.length > 0 && (
        <ImportOverview
          fileName={fileName ?? ''}
          sheets={sheets}
          selected={selected}
          onSelect={applySelection}
          onContinue={leaveOverview}
          refused={ovRefused}
          mode={groupMode}
          onMode={setGroupMode}
          mergeName={mergeName}
          onMergeName={setMergeName}
        />
      )}

      {/* #202: one target at a time, and always say where you are in the
          sequence. The complaint that started this was eleven sheets on one
          screen; a stepper is only an improvement if it never leaves you
          wondering how many are left. */}
      {stage === 'columns' && sheets.length > 0 && targetIndexes.length > 0 && (
        <div className={cardClasses('mb-3 p-3')} data-testid="iw-stepper">
          <div className="flex flex-wrap items-center gap-3">
            {/* #325: the overview rebuilds every chosen sheet's plan, which
                would reset one that already landed to "not imported" and let
                it be sent again. So the way back closes at the first landing. */}
            {sheets.length > 1 && !done && landedCount === 0 && (
              <button
                type="button"
                onClick={() => setStage('overview')}
                data-testid="iw-back-to-overview"
                className={buttonClasses({ className: 'py-1' })}
              >
                ← Choose sheets
              </button>
            )}
            {sheets.length > 1 && !done && landedCount > 0 && (
              <span className="text-xs text-ink-muted" data-testid="iw-sheets-fixed">
                Sheets are fixed once a Table is imported.
              </span>
            )}
            <span
              className="text-sm font-semibold text-ink"
              data-testid="iw-step-of"
            >
              {targetIndexes.length > 1
                ? `Table ${activePos + 1} of ${targetIndexes.length}`
                : 'One Table'}
              {' — '}
              {targetLabel(activeTarget)}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className={buttonClasses({ className: 'py-1 disabled:opacity-40' })}
                data-testid="iw-prev"
                disabled={activePos === 0}
                onClick={() => setCurrent(targetIndexes[activePos - 1])}
              >
                ← Previous
              </button>
              <button
                type="button"
                /* Emphasised once this target has landed: its result is read,
                   and moving on is the only thing left to do here. */
                className={buttonClasses({ variant: activePlan?.result ? 'primary' : 'secondary', className: 'py-1 disabled:opacity-40' })}
                data-testid="iw-next"
                disabled={activePos >= targetIndexes.length - 1}
                onClick={() => setCurrent(targetIndexes[activePos + 1])}
              >
                Next →
              </button>
            </span>
          </div>

          {/* The whole sequence at a glance, and a way to jump. Decided
              targets are marked, so "which of these eleven have I done?" is
              answered without stepping through them. */}
          {targetIndexes.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1" data-testid="iw-step-strip">
              {targetIndexes.map((i, n) => {
                const plan = plans[i]
                const state = plan.result ? 'done' : plan.failure ? 'failed' : 'todo'
                const tone =
                  state === 'done'
                    ? 'border-positive text-positive'
                    : state === 'failed'
                      ? 'border-negative text-negative'
                      : 'border-border text-ink-muted'
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCurrent(i)}
                    data-testid={`iw-step-${i}`}
                    data-state={state}
                    aria-current={i === activeTarget ? 'step' : undefined}
                    className={`rounded border px-2 py-0.5 text-xs ${tone} ${
                      i === activeTarget
                        ? 'bg-action-tint font-semibold'
                        : 'bg-surface'
                    }`}
                  >
                    {state === 'done' ? '✓ ' : state === 'failed' ? '✗ ' : ''}
                    {n + 1}. {targetLabel(i)}
                  </button>
                )
              })}
            </div>
          )}

          <p className="mt-2 text-xs text-ink-muted" data-testid="iw-chosen-count">
            {selected.filter(Boolean).length} of {sheets.length} sheets selected
            {targetIndexes.length > 1 &&
              ` — ${landedCount} of ${targetIndexes.length} Tables imported`}
          </p>
        </div>
      )}

      {stage === 'columns' && sheets.map((rawSheet, i) => {
        const plan = plans[i]
        if (!plan) return null
        // #200: unselected sheets are not shown here at all. Leaving them
        // alone on the overview is how they are excluded, so a card saying
        // "this sheet will not be imported" is noise now.
        if (plan.mode === 'skip') return null
        // #201: a merge group renders ONCE, on its lead. The followers'
        // columns are already folded into the lead's merged set.
        if (plan.groupedInto !== null) return null
        // #202: and only the step being walked. Everything else is reachable
        // from the strip above; results live below, so leaving a card does
        // not hide what it did.
        if (i !== activeTarget) return null
        // From here the card speaks for the whole target: for a group that is
        // the merged column set and every member's rows, so the grid, the
        // mapping and the preview all read one shape.
        const merged = plan.members.length > 1
        const sheet = merged ? effectiveSheet(plan, i) : rawSheet
        // Index-aligned with plan.inferred.columns: the grid's row N is this
        // merged column, and combines are expressed in its key.
        const groupColumns = merged ? mergedColumnsFor(plan) : []
        const inList = listTicks(plan)
        const pickedKeys = groupColumns
          .map((c) => c.key)
          .filter((k) => combinePick[`${i}:${k}`])
        const targetCols = targets.data?.find((t) => t.name === plan.table)?.columns ?? []
        const mappedCount = plan.mapping.filter((m, idx) => m && plan.include[idx]).length
        return (
          <div
            key={sheet.sheetName + i}
            tabIndex={-1}
            className={cardClasses(`mb-4 scroll-mt-4 p-3 outline-none ${flash === i ? 'ring-2 ring-action' : ''}`)}
            data-testid={`iw-sheet-${i}`}
            data-flash={flash === i ? 'true' : undefined}
          >
            <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              {/* The counts describe the FILE's sheet, never the target
                  Table — say so, since sheet and Table often share a name
                  and the Table's own count sits beside the picker. */}
              <div className="text-sm font-semibold text-ink">
                {merged ? (
                  <>
                    <span
                      className={pillClasses('bg-action-tint text-action-hover')}
                      data-testid={`iw-group-${i}`}
                    >
                      {plan.members.length} sheets → one Table
                    </span>{' '}
                    <span className="font-normal text-ink-muted">
                      — {rowCount(plan.members.reduce((n, m) => n + countDataRows(sheets[m].rows), 0))},{' '}
                      {sheet.headers.length} columns combined
                    </span>
                  </>
                ) : (
                  <>
                    Sheet "{sheet.sheetName}"{' '}
                    <span className="font-normal text-ink-muted">
                      — {rowCount(countDataRows(sheet.rows))}, {sheet.headers.length} columns in the file
                    </span>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={labelClasses('m-0')}>Import into</span>
                <TargetPicker
                  i={i}
                  plan={plan}
                  sheet={sheet}
                  targets={targets.data ?? []}
                  onPick={(v) => retarget(i, v)}
                />
                {plan.mode === 'existing' && (
                  <>
                    <TargetRowCount i={i} table={plan.table} />
                    {/* Peek at the target without losing wizard state. */}
                    <a
                      href={tableHref(plan.table)}
                      target="_blank"
                      rel="noreferrer"
                      data-testid={`iw-view-target-${i}`}
                      className="text-xs text-action underline"
                    >
                      view ↗
                    </a>
                  </>
                )}
              </div>
            </div>

            {merged && (
              <div
                className="mb-2 rounded bg-subtle px-2 py-1 text-xs text-ink-muted"
                data-testid={`iw-group-members-${i}`}
              >
                {plan.members.map((m, k) => {
                  // Column names are folded (case, spaces, punctuation), so a
                  // sheet is only "missing" a column when nothing it has folds
                  // to it — and then its rows leave that column empty. Say so
                  // here rather than letting blanks appear unexplained.
                  const cols = mergedColumnsFor(plan)
                  const absent = cols.filter((c) => c.from[k] === -1)
                  return (
                    <span key={m} className="mr-3 inline-block">
                      {sheets[m].sheetName}{' '}
                      <span className="tabular-nums">({fmtCount(countDataRows(sheets[m].rows))} rows)</span>
                      {absent.length > 0 && (
                        <span className="text-caution">
                          {' '}
                          — no {absent.map((c) => c.label).join(', ')}
                        </span>
                      )}
                    </span>
                  )
                })}
              </div>
            )}

            {plan.mode === 'new' ? (
              <>
                {plan.similar && (
                  <div
                    className="mb-2 rounded bg-action-tint px-2 py-1 text-xs text-action"
                    data-testid={`iw-similar-${i}`}
                  >
                    A similar existing Table matches this sheet:{' '}
                    <a
                      href={tableHref(plan.similar.name)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold underline"
                    >
                      {plan.similar.name} ↗
                    </a>{' '}
                    ({plan.similar.mapped} of its {plan.similar.total} columns) — pick it under
                    "Import into" to append there instead of creating a new Table.
                  </div>
                )}
                <div className="mb-2 flex items-center gap-2">
                  <label className={labelClasses('m-0')}>New Table name</label>
                  <input
                    value={plan.table}
                    onChange={(e) => setPlan(i, { table: e.target.value })}
                    data-testid={`iw-new-name-${i}`}
                    className={inputClasses('w-64 py-1')}
                  />
                </div>
                {plan.created_table !== plan.table && (targets.data ?? []).some((t) => t.name === plan.table.trim()) && (
                  <div className="mb-2" data-testid={`iw-name-taken-${i}`}>
                  <Notice tone="caution">
                    A Table called <strong>{plan.table.trim()}</strong> already exists.{' '}
                    <button
                      type="button"
                      className="underline"
                      data-testid={`iw-name-taken-use-${i}`}
                      onClick={() => retarget(i, plan.table.trim())}
                    >
                      Import into it
                    </button>
                    , or give the new Table another name.
                  </Notice>
                  </div>
                )}
                {/* #738: the In list column makes the grid wider than a
                    phone; it scrolls on its own rather than the page. */}
                <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid={`iw-new-grid-${i}`}>
                  <thead className="bg-subtle text-left text-xs text-ink-muted">
                    <tr>
                      {merged && (
                        <th className="px-2 py-1" title="Tick two to combine them">
                          Join
                        </th>
                      )}
                      <th className="px-2 py-1">Use</th>
                      <th className="px-2 py-1 align-bottom">
                        {/* #738: "Tick all" and "Clear" sit above the In
                            list column they act on, which follows Use so a
                            phone shows it without scrolling the grid. */}
                        <div className="flex gap-2 whitespace-nowrap font-normal">
                          <button
                            type="button"
                            onClick={() => setPlan(i, { list_ticks: [...plan.include] })}
                            data-testid={`iw-list-all-${i}`}
                            aria-label="Tick all in the list"
                            className={touchLinkClasses(`text-action underline ${PHONE_LINK}`)}
                          >
                            Tick all
                          </button>
                          <button
                            type="button"
                            onClick={() => setPlan(i, { list_ticks: plan.include.map(() => false) })}
                            data-testid={`iw-list-clear-${i}`}
                            aria-label="Clear the list ticks"
                            className={touchLinkClasses(`text-action underline ${PHONE_LINK}`)}
                          >
                            Clear
                          </button>
                        </div>
                        <span className="whitespace-nowrap">In list</span>
                      </th>
                      <th className="px-2 py-1">File column</th>
                      <th className="px-2 py-1">Label</th>
                      <th className="px-2 py-1">Column name</th>
                      <th className="px-2 py-1">Type</th>
                      <th className="px-2 py-1">Choices or link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* NAM-001: the row id is column one of the grid, not a
                        setting above it — every record has an id, and where it
                        comes from is the same kind of decision as any other
                        column's. Always present, never removable. */}
                    <tr
                      className="border-t border-border bg-action-tint/60"
                      data-testid={`iw-row-id-${i}`}
                    >
                      {merged && <td />}
                      <td className="px-2 py-1 text-center text-ink-subtle" title="always present">
                        🔒
                      </td>
                      <td className="px-2 py-1" colSpan={6}>
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className={labelClasses('m-0 shrink-0')}>Row ID</span>
                          <div className="min-w-0">
                            <NamingControl
                              value={planIdPattern(plan)}
                              onChange={(pattern) => setPlan(i, { id_pattern: pattern })}
                              columns={plan.inferred.columns
                                .filter((c) => c.column_name.trim())
                                .map((c) => ({
                                  column_name: c.column_name,
                                  label: c.label || c.column_name,
                                }))}
                              defaultPrefix={seriesPrefix(plan.table)}
                              idPrefix={`iw-${i}`}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                    {plan.inferred.columns.map((c, ci) => (
                      /* data-columnrow marks the editable column rows — see the
                         same marker in TableBuilder. Specs select on it so the
                         Row ID row (or any later decorative row) cannot shift
                         the indices they read. */
                      <tr
                        key={ci}
                        data-columnrow=""
                        className={`border-t border-border ${plan.include[ci] ? '' : 'opacity-40'}`}
                      >
                        {merged && (
                          <td className="px-2 py-1 text-center">
                            <label className="cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(combinePick[`${i}:${groupColumns[ci]?.key ?? ci}`])}
                                onChange={(e) =>
                                  setCombinePick((prev) => ({
                                    ...prev,
                                    [`${i}:${groupColumns[ci]?.key ?? ci}`]: e.target.checked,
                                  }))
                                }
                                data-testid={`iw-combine-pick-${i}-${ci}`}
                                aria-label={`Combine ${c.label || c.column_name}`}
                              />
                            </label>
                          </td>
                        )}
                        <td className="px-2 py-1 text-center">
                          <label className="cursor-pointer">
                            <input
                              type="checkbox"
                              checked={plan.include[ci]}
                              onChange={(e) =>
                                setPlan(i, {
                                  include: plan.include.map((v, j) => (j === ci ? e.target.checked : v)),
                                })
                              }
                              data-rowfield="include"
                            />
                          </label>
                        </td>
                        <td className="px-2 py-1 text-center">
                          <label className="cursor-pointer">
                            <input
                              type="checkbox"
                              checked={inList[ci]}
                              disabled={!plan.include[ci]}
                              onChange={(e) =>
                                setPlan(i, {
                                  list_ticks: inList.map((v, j) => (j === ci ? e.target.checked : v)),
                                })
                              }
                              data-rowfield="in_list_view"
                              aria-label={`Show ${c.label || c.column_name} in the list`}
                            />
                          </label>
                        </td>
                        <td className="px-2 py-1 text-ink-muted">{sheet.headers[ci]}</td>
                        <td className="px-1 py-1">
                          {/* The display name (normalized from the header);
                              the machine name in the next cell is what the
                              database column will be called. */}
                          <input
                            value={c.label}
                            onChange={(e) =>
                              setPlan(i, {
                                inferred: {
                                  ...plan.inferred,
                                  columns: plan.inferred.columns.map((cc, j) =>
                                    j === ci ? { ...cc, label: e.target.value } : cc,
                                  ),
                                },
                              })
                            }
                            data-rowfield="label"
                            className="w-full rounded border border-border px-1 py-0.5"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            value={c.column_name}
                            onChange={(e) =>
                              setPlan(i, {
                                inferred: {
                                  ...plan.inferred,
                                  columns: plan.inferred.columns.map((cc, j) =>
                                    j === ci ? { ...cc, column_name: e.target.value } : cc,
                                  ),
                                },
                              })
                            }
                            data-rowfield="column_name"
                            placeholder="(skip)"
                            className="w-full rounded border border-border px-1 py-0.5"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <select
                            value={c.column_type}
                            onChange={(e) =>
                              setPlan(i, {
                                inferred: {
                                  ...plan.inferred,
                                  columns: plan.inferred.columns.map((cc, j) =>
                                    j === ci ? withColumnType(plan, cc, ci, e.target.value) : cc,
                                  ),
                                },
                              })
                            }
                            data-rowfield="column_type"
                            className="rounded border border-border px-1 py-0.5"
                          >
                            {COLUMN_TYPES.map((t) => {
                              // #993: a Choice needs options, and a column with no values has none to offer.
                              const noChoices = t === 'Choice' && c.column_type !== 'Choice' && !c.choices &&
                                !plan.members.some((m) => memberSheet(plan, m).rows.some((row) => choiceOptions([row[ci]]).length > 0))
                              return (
                                <option key={t} value={t} disabled={noChoices}>
                                  {noChoices ? 'Choice (no values to offer)' : t}
                                </option>
                              )
                            })}
                          </select>
                        </td>
                        <td
                          className="px-2 py-1 text-xs text-ink-muted"
                          data-rowfield="choices"
                          title={c.column_type === 'Choice' ? c.choices?.split('\n').join(', ') : undefined}
                        >
                          {c.column_type === 'Reference' ? (
                            <select
                              value={c.reference_table ?? ''}
                              onChange={(e) =>
                                setPlan(i, {
                                  inferred: {
                                    ...plan.inferred,
                                    columns: plan.inferred.columns.map((cc, j) =>
                                      j === ci ? { ...cc, reference_table: e.target.value || undefined } : cc,
                                    ),
                                  },
                                })
                              }
                              aria-label={`Table ${c.label || c.column_name} links to`}
                              data-rowfield="reference_table"
                              className="w-40 rounded border border-border px-1 py-0.5 text-sm text-ink"
                            >
                              <option value="">Choose a Table…</option>
                              {(targets.data ?? []).map((t) => (
                                <option key={t.name} value={t.name}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          ) : c.column_type === 'Choice' ? optionsPreview(c.choices) : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>

                {/* #211: the user's own column knowledge, which folding could
                    never supply. Two ticks and a name; the sample values are
                    there so "are these the same thing?" is answered rather
                    than guessed. */}
                {merged && (
                  <div className="mt-2" data-testid={`iw-combine-${i}`}>
                    {groupColumns.some((c) => c.combinedKeys) && (
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        {groupColumns
                          .filter((c) => c.combinedKeys)
                          .map((c) => (
                            <span
                              key={c.key}
                              className={pillClasses('bg-action-tint text-action-hover')}
                              data-testid={`iw-combined-${i}-${c.label}`}
                            >
                              {c.label} — combined by you
                              <button
                                type="button"
                                onClick={() =>
                                  setCombines(
                                    i,
                                    plan.combines.filter(
                                      (x) => x.keys.join('+') !== (c.combinedKeys ?? []).join('+'),
                                    ),
                                  )
                                }
                                data-testid={`iw-uncombine-${i}`}
                                className="ml-1 underline"
                              >
                                undo
                              </button>
                            </span>
                          ))}
                      </div>
                    )}

                    {pickedKeys.length >= 2 ? (
                      (() => {
                        const overlap = combineOverlap(groupColumns, pickedKeys)
                        const names = pickedKeys.map(
                          (k) => groupColumns.find((c) => c.key === k)?.label ?? k,
                        )
                        return (
                          <div className="rounded border border-border-control bg-subtle p-2">
                            <div className="mb-1 text-sm font-medium text-ink">
                              Combine {names.join(' + ')} into one column
                            </div>
                            {/* Sample values: the reason to believe, or not. */}
                            <div className="mb-2 text-xs text-ink-muted">
                              {pickedKeys.map((k) => {
                                const col = groupColumns.find((c) => c.key === k)
                                const from = col?.from.findIndex((x) => x !== -1) ?? -1
                                const sample =
                                  from >= 0 && col
                                    ? sheets[plan.members[from]].rows
                                        .map((r) => r[col.from[from]])
                                        .filter((v) => v != null && String(v).trim() !== '')
                                        .slice(0, 4)
                                        .map((v) => String(v))
                                        .join(' · ')
                                    : ''
                                return (
                                  <div key={k} data-testid={`iw-combine-sample-${i}-${k}`}>
                                    <strong>{col?.label ?? k}</strong>: {sample || '(no values)'}
                                  </div>
                                )
                              })}
                            </div>
                            {overlap.length > 0 ? (
                              <div className="mb-2" data-testid={`iw-combine-overlap-${i}`}>
                                <div className="mb-1 rounded bg-caution-tint px-2 py-1 text-xs text-caution">
                                  {overlap.map((sh) => sheets[plan.members[sh]].sheetName).join(', ')}{' '}
                                  {overlap.length === 1 ? 'has' : 'have'} more than one of these.
                                  Those rows need a rule.
                                </div>
                                <label className="mr-3 text-xs">
                                  <input
                                    type="radio"
                                    name={`iw-combine-rule-${i}`}
                                    checked={combineRule === 'first'}
                                    onChange={() => setCombineRule('first')}
                                    data-testid={`iw-combine-rule-first-${i}`}
                                    className="mr-1 accent-action"
                                  />
                                  Use {names[0]}, falling back to {names[1]}
                                </label>
                                <label className="text-xs">
                                  <input
                                    type="radio"
                                    name={`iw-combine-rule-${i}`}
                                    checked={combineRule === 'join'}
                                    onChange={() => setCombineRule('join')}
                                    data-testid={`iw-combine-rule-join-${i}`}
                                    className="mr-1 accent-action"
                                  />
                                  Join them
                                </label>
                              </div>
                            ) : (
                              <div
                                className="mb-2 rounded bg-positive-tint px-2 py-1 text-xs text-positive"
                                data-testid={`iw-combine-no-overlap-${i}`}
                              >
                                No sheet has more than one of these, so every row takes whichever
                                it has. Nothing to resolve.
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={labelClasses('m-0')}>New column name</span>
                              <input
                                value={combineName || names[0]}
                                onChange={(e) => setCombineName(e.target.value)}
                                data-testid={`iw-combine-name-${i}`}
                                className={inputClasses('w-48 py-1')}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setCombines(i, [
                                    ...plan.combines,
                                    {
                                      name: (combineName || names[0]).trim(),
                                      keys: pickedKeys,
                                      rule: overlap.length ? combineRule : 'first',
                                    },
                                  ])
                                  setCombinePick({})
                                  setCombineName('')
                                }}
                                data-testid={`iw-combine-go-${i}`}
                                className={buttonClasses({ variant: 'primary', className: 'py-1' })}
                              >
                                Combine
                              </button>
                              <button
                                type="button"
                                onClick={() => setCombinePick({})}
                                className={buttonClasses({ className: 'py-1' })}
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                        )
                      })()
                    ) : (
                      <p className="text-xs text-ink-subtle">
                        Tick two columns in the <strong>Join</strong> column to declare them one —
                        for names Featherbase cannot match on its own, like a store code and a
                        store name.
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                {plan.auto_matched && (
                  <div
                    className="mb-1 rounded bg-caution-tint px-2 py-1 text-xs text-caution"
                    data-testid={`iw-auto-matched-${i}`}
                  >
                    Auto-matched to the existing Table{' '}
                    <a
                      href={tableHref(plan.table)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold underline"
                    >
                      {plan.table} ↗
                    </a>{' '}
                    because its columns fit this sheet — {plan.key
                      ? `matching on ${targetCols.find((c) => c.column_name === plan.key)?.label || plan.key}.`
                      : 'rows will be added to it.'} Pick "New Table…" above if you meant to create a separate Table.
                  </div>
                )}
                <div className="mb-1 text-xs text-ink-muted" data-testid={`iw-mapped-count-${i}`}>
                  {mappedCount} of {sheet.headers.length} file columns mapped
                </div>
                <table className="w-full text-sm" data-testid={`iw-mapping-${i}`}>
                  <thead className="bg-subtle text-left text-xs text-ink-muted">
                    <tr>
                      <th className="px-2 py-1">Use</th>
                      <th className="px-2 py-1">File column</th>
                      <th className="px-2 py-1">→ {plan.table} column</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.headers.map((h, hi) => {
                      // #408: a header that is no longer a field of this Table is refused, with a pointer.
                      const retired = retiredColumnNotice(plan.table, h)
                      return (
                      <tr
                        key={hi}
                        className={`border-t border-border ${plan.include[hi] && !retired ? '' : 'opacity-40'}`}
                      >
                        {/* Skipping is the checkbox, same as the new-Table
                            grid — not a buried option inside the select. */}
                        <td className="px-2 py-1 text-center">
                          <label className="cursor-pointer">
                            <input
                              type="checkbox"
                              checked={plan.include[hi] && !retired}
                              disabled={Boolean(retired)}
                              onChange={(e) => {
                                const include = plan.include.map((v, j) =>
                                  j === hi ? e.target.checked : v,
                                )
                                setPlan(i, {
                                  include,
                                  // Unticking the key's file column strands the
                                  // match key — clear it rather than match on
                                  // a column that no longer imports.
                                  key:
                                    plan.key &&
                                    plan.mapping.some((m, j) => m === plan.key && include[j])
                                      ? plan.key
                                      : null,
                                })
                              }}
                              data-testid={`iw-map-use-${i}-${hi}`}
                              data-rowfield="include"
                            />
                          </label>
                        </td>
                        <td className="px-2 py-1 text-ink">
                          {h || <em>(blank)</em>}
                          {retired && (
                            <div className="text-xs text-caution" data-testid={`iw-retired-${i}-${hi}`}>
                              {retired}
                            </div>
                          )}
                        </td>
                        <td className="px-1 py-1">
                          <select
                            value={retired ? '' : (plan.mapping[hi] ?? '')}
                            disabled={Boolean(retired)}
                            onChange={(e) => {
                              const mapping = plan.mapping.map((m, j) =>
                                j === hi ? e.target.value || null : m,
                              )
                              const include = plan.include.map((v, j) =>
                                // Picking a column is intent — re-check the row.
                                j === hi ? Boolean(e.target.value) : v,
                              )
                              setPlan(i, {
                                mapping,
                                include,
                                // A remapped file column can strand the match
                                // key — an unmapped key is no key at all.
                                key:
                                  plan.key && mapping.some((m, j) => m === plan.key && include[j])
                                    ? plan.key
                                    : null,
                              })
                            }}
                            data-testid={`iw-map-${i}-${hi}`}
                            className="rounded border border-border px-1 py-0.5"
                          >
                            <option value="">— pick a column —</option>
                            {/* UPS-R4: the Row ID is a first-class mapping
                                target — the file's own codes become the ids,
                                verbatim; the series continues for rows the
                                file leaves blank. */}
                            <option value="row_id">Row ID</option>
                            {/* Label AND real column name: labels preserve
                                however the source file spelled its headers,
                                so the snake_case identity disambiguates. */}
                            {targetCols.filter((c) => !retiredColumnNotice(plan.table, c.column_name)).map((c) => (
                              <option key={c.column_name} value={c.column_name}>
                                {c.label && c.label !== c.column_name
                                  ? `${c.label} · ${c.column_name}`
                                  : c.column_name}{' '}
                                ({c.column_type})
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>

                {/* UPS-J1.2/J1.3: the Match key control — a real labelled,
                    keyboard-reachable control in the mapping step. Default
                    none: append-always stays the default; upsert is opt-in
                    per run. The empty-cells choice (UPS-R3) appears only
                    once a key is set, defaulting to keep. */}
                {(() => {
                  const keyOptions = [
                    ...new Set(
                      plan.mapping.filter(
                        (m, idx): m is string => m !== null && plan.include[idx],
                      ),
                    ),
                  ]
                  const keyLabel = (col: string) => {
                    if (col === 'row_id') return 'Row ID'
                    const c = targetCols.find((tc) => tc.column_name === col)
                    return c?.label && c.label !== c.column_name
                      ? `${c.label} · ${c.column_name}`
                      : col
                  }
                  // The suggestion speaks the column's friendly name — "Match
                  // on Zone Name, as last time" (UPS-J1.2), not the select's
                  // disambiguated idiom.
                  const friendly = (col: string) =>
                    col === 'row_id'
                      ? 'Row ID'
                      : (targetCols.find((tc) => tc.column_name === col)?.label ?? col)
                  return (
                    <div className="mt-2 border-t border-border pt-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <label htmlFor={`iw-key-${i}`} className={labelClasses('m-0')}>
                          Match key
                        </label>
                        <select
                          id={`iw-key-${i}`}
                          value={plan.key ?? ''}
                          onChange={(e) => setPlan(i, { key: e.target.value || null })}
                          data-testid={`iw-key-${i}`}
                          className="rounded border border-border px-1 py-0.5 text-sm"
                        >
                          <option value="">— none: append every row —</option>
                          {keyOptions.map((col) => (
                            <option key={col} value={col}>
                              {keyLabel(col)}
                            </option>
                          ))}
                        </select>
                        {plan.key && (
                          <span
                            className="flex items-center gap-2 text-sm"
                            data-testid={`iw-empty-cells-${i}`}
                          >
                            <span className={labelClasses('m-0')}>Empty cells</span>
                            <label className="flex items-center gap-1">
                              <input
                                type="radio"
                                name={`iw-empty-${i}`}
                                checked={plan.empty_cells === 'keep'}
                                onChange={() => setPlan(i, { empty_cells: 'keep' })}
                                data-testid={`iw-empty-keep-${i}`}
                              />
                              keep existing values
                            </label>
                            <label className="flex items-center gap-1">
                              <input
                                type="radio"
                                name={`iw-empty-${i}`}
                                checked={plan.empty_cells === 'clear'}
                                onChange={() => setPlan(i, { empty_cells: 'clear' })}
                                data-testid={`iw-empty-clear-${i}`}
                              />
                              clear them
                            </label>
                          </span>
                        )}
                      </div>
                      <KeySuggestions
                        i={i}
                        table={plan.table}
                        rows={mappedRows(sheet, plan)}
                        columns={keyOptions}
                        suggested={plan.suggested}
                        label={friendly}
                        onAccept={(key, empty_cells) => setPlan(i, { key, empty_cells })}
                      />
                      {plan.key && (
                        <p className="mt-1 text-xs text-ink-muted">
                          Matching on {friendly(plan.key)}, rather than appending every row.
                        </p>
                      )}
                      {plan.key && (
                        <UpsertPreview
                          i={i}
                          table={plan.table}
                          keyColumn={plan.key}
                          emptyCells={plan.empty_cells}
                          columns={keyOptions}
                          rows={mappedRows(sheet, plan)}
                          skipped={countDataRows(sheet.rows) - mappedRows(sheet, plan).length}
                        />
                      )}
                    </div>
                  )
                })()}
              </>
            )}

            {/* #115: row numbers are only true against the sheet they came
                from, so a group previews member by member rather than showing
                one blended table with invented numbering. */}
            {(merged ? plan.members : [i]).map((m) => (
              <SheetPreview
                key={m}
                i={merged ? `${i}-${m}` : i}
                label={merged ? sheets[m].sheetName : null}
                sheet={merged ? memberSheet(plan, m) : sheet}
                failed={
                  (plan.result?.failed ?? plan.check?.failed ?? null)?.filter(
                    (f) => f.sheetIndex === m,
                  ) ?? null
                }
              />
            ))}

            {plan.check && (
              <div className="mt-2 text-sm" data-testid={`iw-check-${i}`}>
                {/* Matched rows are not necessarily changed rows. */}
                {plan.check.failed.length === 0 ? (
                  <span className="text-positive">
                    {plan.check.valid === 1
                      ? `✓ The 1 row ${plan.mode === 'new' ? 'links to a row in its Table' : 'is ready to import'}`
                      : `✓ All ${fmtCount(plan.check.valid)} rows ${plan.mode === 'new' ? 'link to a row in their Table' : 'are ready to import'}`}
                  </span>
                ) : (
                  <span className="text-negative">
                    {rowCount(plan.check.valid)} ready, {fmtCount(plan.check.failed.length)} with problems:{' '}
                    {plan.check.failed
                      .slice(0, ERRORS_ON_SCREEN)
                      .map((f) => failLabel(plan, f))
                      .join('; ')}
                    {plan.check.failed.length > 5 && ` … and ${plan.check.failed.length - 5} more`}
                  </span>
                )}
                {plan.key == null && plan.check.tracks_changes === false && (
                  <Notice tone="caution" className="mt-2">This Table does not keep change history. Imports overwrite existing values, including hand edits.</Notice>
                )}
                {plan.key != null && (
                  <div className="mt-2 text-ink" data-testid={`iw-check-fields-${i}`}>
                    <ImportPreviewFacts report={plan.check} />
                  </div>
                )}
                {plan.check.skipped > 0 && (
                  <span className="ml-1 text-ink-muted" data-testid={`iw-check-skipped-${i}`}>
                    ({rowCount(plan.check.skipped)} {plan.check.skipped === 1 ? 'has' : 'have'} no data in the imported columns and will be
                    skipped)
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* #202: what this run has done so far, OUTSIDE the card that did it.
          Stepping to the next target must not hide the result of the last
          one — losing sight of a finished import is the complaint this work
          started from, and with one card on screen the card is the wrong
          place to keep it. */}
      {stage === 'columns' && targetIndexes.some((i) => plans[i]?.result || plans[i]?.failure) && (
        <div className={cardClasses('mb-4 p-3')} data-testid="iw-results">
          <div className={labelClasses('mb-1')}>This import</div>
          {targetIndexes.map((i) => {
            const plan = plans[i]
            if (!plan.result && !plan.failure) return null
            return (
              <div key={i} className="border-t border-border py-2 first:border-t-0">
                {plan.failure && (
                  <div
                    className="rounded bg-negative-tint px-2 py-1 text-sm text-negative"
                    data-testid={`iw-failure-${i}`}
                  >
                    ✗ {plan.table} failed — {plan.failure}{' '}
                    {plan.failureAtPastImports ? (
                      <Link to="/featherbase/admin/imports" className="underline" data-testid={`iw-failure-past-imports-${i}`}>
                        Open Past imports
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="underline"
                        data-testid={`iw-failure-goto-${i}`}
                        onClick={() => fixTarget(i)}
                      >
                        Fix it
                      </button>
                    )}
                  </div>
                )}
                {plan.result && (
                  <div className="text-sm" data-testid={`iw-result-${i}`}>
                    {/* UPS-J1.5: completion reports updated / inserted /
                        failed as separate counts — never one blended
                        number. */}
                    <span className={plan.result.failed.length ? 'text-negative' : 'text-positive'}>
                      {plan.result.updated > 0
                        ? `Recorded ${fmtCount(plan.result.updated)} processed ${plan.result.updated === 1 ? 'match' : 'matches'} and added ${rowCount(plan.result.inserted)} in `
                        : `Imported ${rowCount(plan.result.inserted)} into `}
                      <Link
                        to="/featherbase/admin/table/$table"
                        params={{ table: plan.table }}
                        search={{ filters: undefined }}
                        className="underline"
                      >
                        {plan.table}
                      </Link>
                      {plan.result.failed.length > 0 &&
                        `; ${plan.result.failed.length} failed (first: ${failLabel(
                          plan,
                          plan.result.failed[0],
                        )})`}
                      {plan.result.skipped > 0 &&
                        ` (${rowCount(plan.result.skipped)} had no data in the imported columns and ${plan.result.skipped === 1 ? 'was' : 'were'} skipped)`}
                    </span>
                    <RevertControl i={i} table={plan.table} runId={plan.result.run_id} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {busy && (
        <p className="mt-2 text-sm text-ink-muted" data-testid="iw-progress">
          {busy}
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-negative" data-testid="iw-error">
          {error}
        </p>
      )}
      {runOutcome && !needsFile && (
        <p
          ref={doneRef}
          className={`mt-2 scroll-mb-32 text-sm ${runOutcome.failed.length || runOutcome.refused ? 'text-negative' : 'text-positive'}`}
          data-testid="iw-done"
        >
          {runOutcome.failed.length > 0
            ? `Imported ${fmtCount(runOutcome.imported)}; ${fmtCount(runOutcome.failed.length)} failed: ${runOutcome.failed.join(', ')}.`
            : runOutcome.remaining > 0
              ? `Imported ${fmtCount(runOutcome.imported)}; ${fmtCount(runOutcome.remaining)} still to import.`
              : runOutcome.refused
                ? `${runOutcome.refused === 1 ? '1 row was' : `${fmtCount(runOutcome.refused)} rows were`} refused. See above.`
                : 'Import complete.'}
        </p>
      )}

      {stage === 'columns' && sheets.length > 0 && !done && (
        <div className="sticky bottom-0 z-10 mt-4 flex items-center gap-2 rounded-t-[var(--radius-card)] border-t border-border-control bg-surface px-2 py-3 shadow-[0_-6px_16px_color-mix(in_srgb,var(--color-scrim)_9%,transparent)]">
          {/* #202: check what is on screen. Rehearsing targets you cannot
              see puts their report somewhere you are not looking. */}
          {(activePlan?.mode === 'existing' || (activePlan && linkColumns(activePlan).length > 0)) && (
            <button
              onClick={() => void runCheck(activeTarget)}
              disabled={!!busy || activeUnpicked.length > 0}
              data-testid="iw-check"
              className={buttonClasses({ className: 'disabled:opacity-40' })}
            >
              Check
            </button>
          )}
          {unpickedLinks.length > 0 && (
            <span className="mr-2 rounded bg-caution-tint px-2 py-1 text-sm text-caution" data-testid="iw-links-unpicked">
              Choose the Table that {unpickedLinks.join(', ')} {unpickedLinks.length === 1 ? 'links' : 'link'} to before importing.
            </span>
          )}
          {confirmUpdates && (
            <span
              className="mr-2 rounded bg-caution-tint px-2 py-1 text-sm text-caution"
              data-testid="iw-confirm-updates"
            >
              This import will <strong>change {fmtCount(confirmUpdates.total)} existing rows</strong>. Type{' '}
              <strong>{fmtCount(confirmUpdates.total)}</strong> to confirm:{' '}
              <input
                className={inputClasses('mx-1 w-24 py-0.5')}
                data-testid="iw-confirm-input"
                aria-label={`Type ${fmtCount(confirmUpdates.total)} to confirm changing ${fmtCount(confirmUpdates.total)} rows`}
                value={confirmUpdates.typed}
                onChange={(e) => setConfirmUpdates({ ...confirmUpdates, typed: e.target.value })}
              />
              <button
                className={buttonClasses({ variant: 'primary', className: 'py-0.5 disabled:opacity-40' })}
                data-testid="iw-confirm-go"
                disabled={!!busy || !confirmsCount(confirmUpdates.typed, confirmUpdates.total)}
                onClick={() => void runImport(confirmUpdates.only)}
              >
                Change {fmtCount(confirmUpdates.total)} rows
              </button>
            </span>
          )}
          {appendWarning && !confirmUpdates && (
            <div className="rounded bg-caution-tint px-2 py-1 text-sm text-caution" data-testid="iw-append-warning">
              Appending adds {fmtCount(appendWarning.targets.reduce((n, t) => n + t.rows, 0))} more rows
              {' '}to {appendWarning.targets.map((t) => t.table).join(', ')} rather than matching existing rows.
              {' '}Choose a matching column above instead, or deliberately add another set.
              <label className="mx-2 inline-flex items-center gap-1">
                <input type="checkbox" data-testid="iw-append-ack" checked={appendWarning.acknowledged}
                  onChange={(e) => setAppendWarning({ ...appendWarning, acknowledged: e.target.checked })} />
                Add another set of rows
              </label>
              <button type="button" data-testid="iw-append-go"
                className={buttonClasses({ variant: 'primary', className: 'py-0.5 disabled:opacity-40' })}
                disabled={!!busy || !appendWarning.acknowledged}
                onClick={() => void runImport(appendWarning.only)}>
                Append deliberately
              </button>
            </div>
          )}
          {/* #202: import THIS target, then step on. The owner asked to
              "import and then go to that screen where the row is imported"
              mid-flow — which needs a commit per target, not one run at the
              end of eleven. */}
          {targetIndexes.length > 1 &&
            activeTarget !== -1 &&
            (activePlan?.result ? (
              <span className="text-sm text-positive" data-testid="iw-import-one-done">
                ✓ {activePlan.table} imported
              </span>
            ) : (
              <button
                onClick={() => void runImport(activeTarget)}
                disabled={!!busy || !!confirmUpdates || !!appendWarning || activeUnpicked.length > 0}
                data-testid="iw-import-one"
                className={buttonClasses({ variant: 'primary', className: 'disabled:opacity-40' })}
              >
                {`Import ${rowCount(targetRows(activeTarget))} into ${activePlan?.table || 'this Table'}`}
              </button>
            ))}
          <button
            onClick={() => void runImport()}
            disabled={
              !!busy ||
              !!confirmUpdates ||
              !!appendWarning ||
              unpickedLinks.length > 0 ||
              plans.every((p) => p.mode === 'skip') ||
              targetIndexes.every((i) => plans[i]?.result)
            }
            data-testid="iw-import"
            className={buttonClasses({ variant: targetIndexes.length > 1 ? 'secondary' : 'primary', className: 'disabled:opacity-40' })}
          >
            {anyChecked && blockingProblems > 0
              ? `Import anyway (skip ${fmtCount(blockingProblems)} bad rows)`
              : targetIndexes.length > 1
                ? (() => {
                    const left = targetIndexes.filter((i) => !plans[i]?.result).length
                    return `Import the remaining ${left} Table${left === 1 ? '' : 's'}`
                  })()
                : `Import ${rowCount(
                    sheets.reduce(
                      (n, s, si) => n + (plans[si]?.mode === 'skip' ? 0 : countDataRows(s.rows)),
                      0,
                    ),
                  )}`}
          </button>
        </div>
      )}
    </div>
  )
}

// #204 (issue #197): the import wizard's work survives leaving the page.
//
// The owner's session: "I imported one of the sheets and then there was an
// error in the second sheet. I clicked on see the rows imported and went, and
// when I came back nothing was visible." Everything — the sheet selection,
// eleven Tables' worth of names, mappings and combines, and the results
// already committed — lived in component state and died with the route.
//
// Two keys, deliberately:
//
//   - **Decisions** are small and change on every keystroke, so they are
//     written often and cheaply.
//   - **The file's rows** are large and change once per file, so they are
//     written once. Re-serialising a 17-sheet workbook on every character
//     typed into a column name would be the obvious way to make the wizard
//     feel broken.
//
// And the rows are the half allowed to fail. sessionStorage is a few
// megabytes; a big workbook will not fit, and the right answer then is to
// keep every decision and ask for the file again — never to lose the work
// because the data was too big to carry with it.
import type { ParsedSheet } from './parse-file'

export const IMPORT_DECISIONS_KEY = 'featherbase:import-wizard'
export const IMPORT_DATA_KEY = 'featherbase:import-wizard-data'

/**
 * Enough of a workbook to recognise it again. A re-dropped file must be the
 * same file before saved plans are applied to it: plans address sheets by
 * index, so applying them to a different workbook would silently point
 * mappings at the wrong columns.
 */
export interface SheetShape {
  sheetName: string
  headers: string[]
  rows: number
}

export interface ImportDecisions<Plan> {
  fileName: string
  stage: 'overview' | 'columns'
  selected: boolean[]
  plans: Plan[]
  natural: Plan[]
  current: number
  groupMode: 'separate' | 'merge'
  mergeName: string
  outcome: { imported: number; failed: string[]; remaining: number } | null
  done: boolean
  shape: SheetShape[]
}

export function shapeOf(sheets: ParsedSheet[]): SheetShape[] {
  return sheets.map((s) => ({ sheetName: s.sheetName, headers: s.headers, rows: s.rows.length }))
}

export function sameShape(a: SheetShape[], b: SheetShape[]): boolean {
  if (a.length !== b.length) return false
  return a.every((s, i) => {
    const o = b[i]
    return (
      s.sheetName === o.sheetName &&
      s.rows === o.rows &&
      s.headers.length === o.headers.length &&
      s.headers.every((h, j) => h === o.headers[j])
    )
  })
}

// Storage can throw rather than return: Safari's private mode, a quota that
// is already full, a browser configured to block site data. None of those are
// worth failing an import over, so every access is guarded and a failure
// simply means "no saved session".
function store(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function write(key: string, value: unknown): boolean {
  const s = store()
  if (!s) return false
  try {
    s.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function read<T>(key: string): T | null {
  const s = store()
  if (!s) return null
  try {
    const raw = s.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function saveDecisions<Plan>(decisions: ImportDecisions<Plan>): boolean {
  return write(IMPORT_DECISIONS_KEY, decisions)
}

export function loadDecisions<Plan>(): ImportDecisions<Plan> | null {
  const saved = read<ImportDecisions<Plan>>(IMPORT_DECISIONS_KEY)
  // A shape written by an older build, or a half-written entry, must not
  // crash the wizard on arrival — treat anything unrecognisable as absent.
  if (!saved || typeof saved.fileName !== 'string' || !Array.isArray(saved.plans)) return null
  if (!Array.isArray(saved.shape) || !Array.isArray(saved.selected)) return null
  return saved
}

/**
 * The parsed rows, if they fit. Returns whether they were kept — the caller
 * uses that to tell the user the file will need dropping again, which is far
 * better than finding out on return.
 */
export function saveSheets(fileName: string, sheets: ParsedSheet[]): boolean {
  const kept = write(IMPORT_DATA_KEY, { fileName, sheets })
  if (!kept) clearSheets()
  return kept
}

export function loadSheets(fileName: string): ParsedSheet[] | null {
  const saved = read<{ fileName: string; sheets: ParsedSheet[] }>(IMPORT_DATA_KEY)
  if (!saved || saved.fileName !== fileName || !Array.isArray(saved.sheets)) return null
  return saved.sheets
}

export function clearSheets(): void {
  try {
    store()?.removeItem(IMPORT_DATA_KEY)
  } catch {
    /* nothing to clear */
  }
}

export function clearSession(): void {
  try {
    store()?.removeItem(IMPORT_DECISIONS_KEY)
    store()?.removeItem(IMPORT_DATA_KEY)
  } catch {
    /* nothing to clear */
  }
}

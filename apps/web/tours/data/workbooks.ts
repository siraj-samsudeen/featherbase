// The base tour's spreadsheets, made the way real ones arrive: one sheet per
// store, each typed up by a different person. Column names drift ("Asset Tag",
// "Tag No", "asset tag"), and so do the values ("Ground Floor", "ground
// floor", " GROUND FLOOR", "GF"). Generated, not committed, so the data is
// plainly made up and the size is a knob (TOUR_ROWS).
import * as XLSX from 'xlsx'

export const STORES = [
  { code: 'Anna Nagar', city: 'Chennai', region: 'North', opened: '2009-08-14' },
  { code: 'T Nagar', city: 'Chennai', region: 'Central', opened: '1996-04-01' },
  { code: 'Velachery', city: 'Chennai', region: 'South', opened: '2015-11-20' },
] as const

const ITEMS = ['Billing counter', 'Display rack', 'Air conditioner', 'Trial room mirror', 'CCTV camera', 'Mannequin', 'Cash drawer', 'Barcode printer', 'Glass showcase', 'Ceiling fan']
const ROOMS = ['Front', 'Silk sarees', 'Cotton sarees', 'Kids', 'Trial rooms', 'Billing', 'Store room']

/** Each store's sheet, as its own clerk wrote it. */
const SHEETS = [
  {
    store: 'Anna Nagar',
    prefix: 'AN',
    headers: ['Asset Tag', 'Item', 'Store', 'Floor', 'Room', 'Purchase Date', 'Cost'],
    // How this clerk spells each floor, by how often.
    floors: { ground: ['Ground Floor', 'Ground Floor', 'Ground Floor', 'ground floor'], first: ['First Floor', 'First Floor', 'first floor '] },
    stores: ['Anna Nagar'],
  },
  {
    store: 'T Nagar',
    prefix: 'TN',
    headers: ['Tag No', 'Item Name', 'Branch', 'floor ', 'Room', 'Bought On', 'Cost (Rs)'],
    floors: { ground: ['Ground Floor', 'Ground Floor', 'GF'], first: ['First Floor', 'First Floor', '1st Floor', 'FF'] },
    stores: ['T Nagar', 'T Nagar', 'T Nagar', 'T Nagar', 'T Nagar', 'T Nagar', 'T Nagar', 'T Nagar', 'T Nagar', 'T. Nagar'],
  },
  {
    store: 'Velachery',
    prefix: 'VL',
    headers: ['asset tag', 'Item', 'store name', 'Floor', 'Section', 'Purchase date', 'Cost'],
    floors: { ground: ['Ground Floor', ' GROUND FLOOR'], first: ['First Floor'] },
    stores: ['Velachery'],
  },
] as const

/** A small, repeatable pseudo-random sequence, so every run sees the same sheets. */
function sequence(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

export interface Asset {
  tag: string
  item: string
  store: string
  floor: string
  room: string
  bought: string
  cost: number
}

/** Every store's assets as the sheets hold them: messy spellings and all. */
export function assets(rowsPerStore: number): Map<string, Asset[]> {
  const out = new Map<string, Asset[]>()
  SHEETS.forEach((sheet, si) => {
    const next = sequence(17 + si)
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!
    const rows: Asset[] = []
    for (let i = 1; i <= rowsPerStore; i++) {
      const ground = next() < 0.6
      const day = new Date(Date.UTC(2018, 0, 1) + Math.floor(next() * 2400) * 86_400_000)
      rows.push({
        tag: `${sheet.prefix}-${String(i).padStart(4, '0')}`,
        item: pick(ITEMS),
        store: pick(sheet.stores),
        floor: pick(ground ? sheet.floors.ground : sheet.floors.first),
        room: pick(ROOMS),
        bought: day.toISOString().slice(0, 10),
        cost: 1000 * Math.round(2 + next() * 120),
      })
    }
    out.set(sheet.store, rows)
  })
  return out
}

function workbook(sheets: [name: string, rows: (string | number)[][]][]): Buffer {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/** The store master: one clean list, as head office keeps it. */
export function storesWorkbook(): Buffer {
  return workbook([['Stores', [['Store', 'City', 'Region', 'Opened'], ...STORES.map((s) => [s.code, s.city, s.region, s.opened])]]])
}

/** The asset register: one sheet per store, each in its own clerk's style. */
export function assetsWorkbook(rowsPerStore: number): Buffer {
  const all = assets(rowsPerStore)
  return workbook(
    SHEETS.map((sheet) => [
      sheet.store,
      [[...sheet.headers], ...all.get(sheet.store)!.map((a) => [a.tag, a.item, a.store, a.floor, a.room, a.bought, a.cost])],
    ]),
  )
}

/**
 * A month later, T Nagar sends its whole sheet again, now in the cleaned-up
 * column names: two prices corrected and three new assets. The rest is
 * unchanged, as a monthly export is, and still spelt the clerk's way.
 */
export function tNagarUpdate(rowsPerStore: number): { file: Buffer; changed: string[]; added: string[]; misspelt: string } {
  const rows = assets(rowsPerStore).get('T Nagar')!
  rows[0]!.cost += 500
  rows[1]!.cost += 750
  // The clerk still types "T. Nagar" now and then: once, on a new asset.
  const added = [1, 2, 3].map((n) => ({ ...rows[n]!, tag: `TN-${String(rowsPerStore + n).padStart(4, '0')}`, item: 'Mannequin', store: n === 3 ? 'T. Nagar' : 'T Nagar' }))
  const header = ['Asset Tag', 'Item', 'Store', 'Floor', 'Department', 'Purchase Date', 'Cost']
  const out = [...rows, ...added].map((a) => [a.tag, a.item, a.store, a.floor.trim(), a.room, a.bought, a.cost])
  return { file: workbook([['T Nagar', [header, ...out]]]), changed: [rows[0]!.tag, rows[1]!.tag], added: added.map((a) => a.tag), misspelt: added[2]!.tag }
}

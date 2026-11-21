// MADE-UP DATA. No real store, person, code or figure. It stands in for what the warehouse will
// serve the app (Runs, each basis's value, actual sales), so every state of the pages can be seen
// on a local instance. Codes start with 9 so none can be mistaken for an SAP subcategory code.

export type Code = 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6'
export const BASES: { code: Code; name: string }[] = [
  { code: 'B6', name: "Festival lift: last 28 days × past years' month ratio" },
  { code: 'B1', name: 'Same date last year, × growth' },
  { code: 'B2', name: 'Same festival position last year, × growth' },
  { code: 'B3', name: "Last 28 days' run rate" },
  { code: 'B4', name: 'Last four same weekdays' },
  { code: 'B5', name: 'Same date last month' },
]
export const UPLIFT = 0.06

export interface Person { id: string; name: string; code: string; role: string; place: string; reportsTo?: string }
export const PEOPLE: Person[] = [
  { id: 'asha', name: 'Asha', code: 'MU-1042', role: 'Team Leader', place: 'Lakeside · Girls Bottoms', reportsTo: 'mani' },
  { id: 'ravi', name: 'Ravi', code: 'MU-1077', role: 'Team Leader', place: 'Lakeside · Men Top', reportsTo: 'mani' },
  { id: 'meena', name: 'Meena', code: 'MU-2015', role: 'Team Leader', place: 'Hillview · Girls Bottoms', reportsTo: 'gopal' },
  { id: 'mani', name: 'Mani', code: 'MU-0910', role: 'Department Manager', place: 'Lakeside', reportsTo: 'selvi' },
  { id: 'gopal', name: 'Gopal', code: 'MU-0933', role: 'Department Manager', place: 'Hillview', reportsTo: 'hari' },
  { id: 'selvi', name: 'Selvi', code: 'MU-0500', role: 'Store Manager', place: 'Lakeside', reportsTo: 'kumar' },
  { id: 'hari', name: 'Hari', code: 'MU-0512', role: 'Store Manager', place: 'Hillview', reportsTo: 'kumar' },
  { id: 'bina', name: 'Bina', code: 'MU-0301', role: 'Category Head', place: 'Girls · East', reportsTo: 'kumar' },
  { id: 'farah', name: 'Farah', code: 'MU-0120', role: 'Forecasting Lead', place: 'Head Office', reportsTo: 'kumar' },
  { id: 'kumar', name: 'Kumar', code: 'MU-0001', role: 'Chief Executive', place: 'Head Office' },
]
export const person = (id: string) => PEOPLE.find(p => p.id === id)!
export const personByName = (name: string) => PEOPLE.find(p => p.name === name)

export interface Sub {
  store: string; section: string; category: string; name: string; code: string
  /** November, the engine's month figure before tax, and its parts. */
  engine: number; parts: Partial<Record<Code, [weight: number, value: number]>>; other: number
  fc20: number; act20: number
  /** October, for Results: the engine's figure and what sold. */
  octEngine: number; octActual: number
}

/** [weight, the basis's own November value]. A basis at 0% has its value too: the engine stores it. */
const S = (store: string, section: string, category: string, name: string, code: string, engine: number, fc20: number, act20: number,
  octEngine: number, octActual: number, parts: Sub['parts'], other = 0): Sub =>
  ({ store, section, category, name, code, engine, fc20, act20, octEngine, octActual, parts, other })

export const SUBS: Sub[] = [
  S('Lakeside', 'Girls Bottoms', 'Girls Bottom', 'Girls Jean', '910202002', 497700, 326095, 480728, 412000, 455300,
    { B6: [0.4952, 694200], B1: [0.2452, 283900], B2: [0.2595, 216300], B3: [0, 512000], B4: [0, 498500], B5: [0, 455300] }, -1),
  S('Lakeside', 'Girls Bottoms', 'Girls Bottom', 'Girls Short', '910202009', 297582, 197167, 183574, 268000, 251900,
    { B6: [0.6619, 331900], B1: [0.0881, 195100], B2: [0.25, 175500], B3: [0, 262000], B4: [0, 255400], B5: [0, 251900] }),
  S('Lakeside', 'Girls Bottoms', 'Girls Bottom', 'Girls Leggings', '910202003', 157288, 104381, 87270, 151000, 139800,
    { B6: [1, 144125], B1: [0, 131000], B2: [0, 128400], B3: [0, 129900], B4: [0, 127100], B5: [0, 139800] }, 4260),
  S('Lakeside', 'Girls Bottoms', 'Girls Bottom', 'Girls Skirt', '910202010', 140004, 92911, 107720, 118500, 131200,
    { B6: [0.5571, 130400], B2: [0.3119, 121200], B3: [0.0952, 124700], B4: [0.0357, 120800], B1: [0, 109000], B5: [0, 131200] }, 5429),
  S('Lakeside', 'Girls Bottoms', 'Girls Bottom', 'Girls Palazzo', '910202006', 154868, 102775, 88345, 139000, 121500,
    { B6: [0.6619, 144200], B1: [0.1619, 153800], B2: [0.1762, 153400], B3: [0, 118000], B4: [0, 116300], B5: [0, 121500] }, -1259),
  S('Lakeside', 'Girls Bottoms', 'Health Drinks', 'Malt Drinks', '930304001', 94529, 65482, 56622, 91000, 88400,
    { B3: [0.7262, 88370], B4: [0.1119, 90820], B2: [0.05, 109700], B1: [0.0381, 113600], B6: [0.0381, 92680], B5: [0.0357, 86580] }, -1593),
  S('Lakeside', 'Men Top', 'Men Top', 'Men Formal Shirt', '910401002', 6551077, 4330944, 4914343, 5820000, 6104000,
    { B1: [0.3262, 6258900], B2: [0.4119, 6023000], B6: [0.2619, 6329600], B3: [0, 5798200], B4: [0, 5760000], B5: [0, 5685300] }),
  S('Lakeside', 'Men Top', 'Men Top', 'Men Casual Shirt', '910401001', 5226343, 3494506, 4005444, 4610000, 4455000,
    { B6: [0.502, 4926400], B1: [0.224, 5294900], B2: [0.174, 4605800], B3: [0.062, 4698200], B4: [0.038, 4702800], B5: [0, 4454600] }),
  S('Lakeside', 'Men Top', 'Men Top', 'Men T Shirt', '910401003', 3323042, 2215003, 2093535, 3105000, 2941000,
    { B6: [0.579, 3091000], B1: [0.16, 3397800], B2: [0.136, 3136000], B3: [0.088, 2960000], B4: [0.038, 3016500], B5: [0, 2942300] }),
  S('Hillview', 'Girls Bottoms', 'Girls Bottom', 'Girls Jean', '910202002', 812400, 538000, 512300, 702000, 731900,
    { B6: [0.42, 801000], B1: [0.31, 742000], B2: [0.27, 698000], B3: [0, 690000], B4: [0, 701000], B5: [0, 731900] }),
  S('Hillview', 'Girls Bottoms', 'Girls Bottom', 'Girls Short', '910202009', 402100, 266400, 301800, 371000, 409900,
    { B6: [0.55, 390000], B1: [0.2, 371000], B2: [0.25, 362000], B3: [0, 398000], B4: [0, 401000], B5: [0, 409900] }),
  S('Hillview', 'Girls Bottoms', 'Girls Bottom', 'Girls Leggings', '910202003', 251900, 166900, 149200, 236000, 228100,
    { B6: [0.8, 240000], B2: [0.2, 228000], B1: [0, 221000], B3: [0, 219000], B4: [0, 224000], B5: [0, 228100] }),
]
export const subKey = (s: Pick<Sub, 'store' | 'name'>) => `${s.store}|${s.name}`

export const value = (s: Sub, c: Code) => s.parts[c]?.[1] ?? null
export const weightOf = (s: Sub, c: Code) => s.parts[c]?.[0] ?? 0
/** A weight change recomputes that row only: Σ weight × value, the uplift, then the Run's other steps. */
export const fromWeights = (s: Sub, percent: Partial<Record<Code, number>>) =>
  BASES.reduce((n, b) => n + ((percent[b.code] ?? 0) / 100) * (value(s, b.code) ?? 0), 0) * (1 + UPLIFT) + s.other

// The engine's figure IS its parts: computed here so the "why" always adds up to it. The forecast to
// the 20th follows the month's day shape (two-thirds of November by the 20th).
SUBS.forEach(s => {
  s.engine = Math.round(fromWeights(s, Object.fromEntries(BASES.map(b => [b.code, weightOf(s, b.code) * 100]))))
  s.fc20 = Math.round(s.engine * 0.665)
})

/** Engine Runs and target versions: what Runs & Targets lists. */
export interface Run { id: string; month: string; purpose: 'official' | 'trial' | 'baseline'; origin: string; written: string; note: string; wape: number | null; total: number }
export const RUNS: Run[] = [
  { id: 'demo_2026_11_official', month: 'Nov 2026', purpose: 'official', origin: '30-Oct-2026', written: '02-Nov-2026', note: 'Engine on sales to 30-Oct, the toys layer and a flat 6% uplift (a judgement call)', wape: null, total: 0 },
  { id: 'demo_2026_11_trial_no_festival', month: 'Nov 2026', purpose: 'trial', origin: '30-Oct-2026', written: '01-Nov-2026', note: 'Same, festival lift (B6) switched off', wape: null, total: 0 },
  { id: 'demo_2026_11_naive_weekly', month: 'Nov 2026', purpose: 'baseline', origin: '30-Oct-2026', written: '02-Nov-2026', note: 'Same weekday, last four weeks', wape: null, total: 0 },
  { id: 'demo_2026_10_official', month: 'Oct 2026', purpose: 'official', origin: '30-Sep-2026', written: '01-Oct-2026', note: 'Engine on sales to 30-Sep, festival-aligned', wape: 0.184, total: 0 },
  { id: 'demo_2026_10_naive_weekly', month: 'Oct 2026', purpose: 'baseline', origin: '30-Sep-2026', written: '01-Oct-2026', note: 'Same weekday, last four weeks', wape: 0.271, total: 0 },
]
RUNS.forEach(r => {
  const nov = SUBS.reduce((n, s) => n + s.engine, 0)
  const oct = SUBS.reduce((n, s) => n + s.octEngine, 0)
  r.total = r.month === 'Nov 2026' ? (r.purpose === 'official' ? nov : r.purpose === 'trial' ? nov * 0.94 : nov * 0.88) : (r.purpose === 'official' ? oct : oct * 0.91)
})

export interface TargetVersion { month: string; revision: number; fromRun: string; loaded: string; total: number; note: string }
export const TARGETS: TargetVersion[] = [
  { month: 'Nov 2026', revision: 6, fromRun: 'demo_2026_11_official', loaded: 'next build', total: 0, note: 'Engine + the numbers applied so far (proposed)' },
  { month: 'Nov 2026', revision: 5, fromRun: 'demo_2026_11_official', loaded: '02-Nov-2026', total: 0, note: 'The official Run as the target; food court from the business plan' },
  { month: 'Oct 2026', revision: 4, fromRun: 'demo_2026_10_official', loaded: '01-Oct-2026', total: 0, note: 'The official Run as the target' },
]

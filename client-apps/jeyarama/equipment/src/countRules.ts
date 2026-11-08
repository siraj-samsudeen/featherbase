// How a verification count's records become review lines. Pure: the server's
// close rule and the review page both use it.

export const OUTCOMES = ['Found here', 'Damaged', 'Idle', 'Belongs elsewhere'] as const
export const MISSING_DECISIONS = ['Recount', 'Found later', 'Mapping corrected', 'To Loss Prevention', 'Propose retirement to Finance'] as const
export const UNLISTED_DECISIONS = ['Capitalize', 'Controlled item', 'Third-party'] as const

export interface ExpectedLine { asset: string; expected_place: string | null }
export interface ScanLine { row_id: string; asset: string | null; outcome: string; duplicate: boolean }
export interface DecisionLine { asset: string | null; scan: string | null; decision: string }

const BUCKET: Record<string, 'found' | 'damaged' | 'idle' | 'elsewhere'> = {
  'Found here': 'found', Damaged: 'damaged', Idle: 'idle', 'Belongs elsewhere': 'elsewhere',
}

export function reviewLines({ expected, scans, placeNow, decisions }: {
  expected: ExpectedLine[]; scans: ScanLine[]; placeNow: ReadonlyMap<string, string | null>; decisions: DecisionLine[]
}) {
  const lines = { found: [] as string[], damaged: [] as string[], idle: [] as string[], elsewhere: [] as string[],
    missing: [] as string[], moved: [] as string[], unlisted: [] as string[], duplicate: [] as string[] }
  const expectedAssets = new Set(expected.map(line => line.asset))
  const recorded = new Set<string>()
  for (const scan of scans) {
    if (scan.duplicate) { lines.duplicate.push(scan.row_id); continue }
    if (!scan.asset || !expectedAssets.has(scan.asset)) { lines.unlisted.push(scan.row_id); continue }
    if (recorded.has(scan.asset)) { lines.duplicate.push(scan.row_id); continue }
    recorded.add(scan.asset)
    const bucket = BUCKET[scan.outcome]
    if (bucket) lines[bucket].push(scan.asset)
  }
  for (const line of expected) {
    if (recorded.has(line.asset)) continue
    if ((placeNow.get(line.asset) ?? null) !== line.expected_place) lines.moved.push(line.asset)
    else lines.missing.push(line.asset)
  }
  for (const key of ['found', 'damaged', 'idle', 'elsewhere'] as const) lines[key].sort((a, b) => order(expected, a) - order(expected, b))

  const byAsset = new Map(decisions.filter(d => d.asset).map(d => [d.asset!, d.decision]))
  const byScan = new Map(decisions.filter(d => d.scan).map(d => [d.scan!, d.decision]))
  const recount = lines.missing.filter(asset => byAsset.get(asset) === 'Recount')
  const undecided = {
    missing: lines.missing.filter(asset => !byAsset.get(asset) || byAsset.get(asset) === 'Recount'),
    unlisted: lines.unlisted.filter(scan => !byScan.get(scan)),
  }
  const counts = Object.fromEntries(Object.entries(lines).map(([key, value]) => [key, value.length])) as Record<keyof typeof lines, number>
  return { expected: expected.length, lines, counts, recount, undecided, closable: !undecided.missing.length && !undecided.unlisted.length }
}

function order(expected: ExpectedLine[], asset: string) {
  return expected.findIndex(line => line.asset === asset)
}

export interface PlaceNode { row_id: string; parent_place?: string | null }

/** Whether a place is the counted place or anywhere inside it. */
export function withinPlace(placeId: string | null | undefined, scope: string, places: PlaceNode[]): boolean {
  const byId = new Map(places.map(place => [place.row_id, place]))
  const seen = new Set<string>()
  let current = placeId ? byId.get(placeId) : undefined
  while (current && !seen.has(current.row_id)) {
    if (current.row_id === scope) return true
    seen.add(current.row_id)
    current = current.parent_place ? byId.get(current.parent_place) : undefined
  }
  return false
}

/** A random sample of `size` ids, each at most once. */
export function pickSample<T>(ids: T[], size: number, random: () => number): T[] {
  const pool = [...ids]
  const picked: T[] = []
  while (picked.length < size && pool.length) picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0])
  return picked
}

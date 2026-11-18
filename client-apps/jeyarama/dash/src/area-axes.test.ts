// #1282 G1–G6 (Codex standard round 1): the picker offers and counts the Sites the server's Correct and Also Give
// accept, by the same openStore rule: an open Store though its is_store flag is off; never a Closed or Group site.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DASH_AREAS, forgetStoreFields, loadDashArea } from './area-axes'

const SITES = [
  { row_id: 's1', name: 'Open Store', cluster: 'c1', is_store: 0, site_kind: 'Store', status: 'Open' },
  { row_id: 's2', name: 'Closed Store', cluster: 'c1', is_store: 1, site_kind: 'Store', status: 'Closed' },
  { row_id: 's3', name: 'A Group', cluster: 'c1', is_store: 1, site_kind: 'Group', status: 'Open' },
]

function serve(readable: string[]) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    if (url.endsWith('Site:meta')) return new Response(JSON.stringify({ readable_columns: ['name', 'cluster', ...readable] }))
    const query = new URL(url, 'http://x').searchParams
    const table = decodeURIComponent(new URL(url, 'http://x').pathname.split('/').pop()!)
    const fields: string[] = JSON.parse(query.get('fields')!)
    const filters: [string, string, unknown][] = JSON.parse(query.get('filters')!)
    const rows = (table === 'Cluster' ? [{ row_id: 'c1', name: 'South' }] : SITES).filter(r => filters.every(([f, , v]) => (r as Record<string, unknown>)[f] === v))
    return new Response(JSON.stringify({ data: rows.map(r => Object.fromEntries(fields.filter(f => f in r).map(f => [f, (r as Record<string, unknown>)[f]]))), total: rows.length }))
  }))
  return calls
}

afterEach(() => { vi.unstubAllGlobals(); forgetStoreFields() })
const LOCATION = DASH_AREAS[0]!

describe("the picker's stores", () => {
  it('offers and counts only open stores, as the server gives a role at them', async () => {
    serve(['is_store', 'site_kind', 'status'])
    expect(await loadDashArea(LOCATION, 0, null)).toEqual([{ id: 'c1', name: 'South', count: 1 }])
    expect((await loadDashArea(LOCATION, 1, { id: 'c1', name: 'South' })).map(r => r.name)).toEqual(['Open Store'])
  })

  it('reads only the Site columns the viewer may read, asking the Table once', async () => {
    const calls = serve(['is_store'])
    // With no site_kind or status to read, the is_store flag decides.
    expect((await loadDashArea(LOCATION, 1, { id: 'c1', name: 'South' })).map(r => r.name)).toEqual(['Closed Store', 'A Group'])
    await loadDashArea(LOCATION, 1, { id: 'c1', name: 'South' })
    expect(calls.filter(c => c.endsWith(':meta'))).toHaveLength(1)
  })

  it('keeps a store to pick when the floors under it may not be read, leaving its count off', async () => {
    serve(['is_store', 'site_kind', 'status'])
    const inner = (fetch as unknown as ReturnType<typeof vi.fn>).getMockImplementation() as (url: string) => Promise<Response>
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('Store%20Floor') ? new Response('', { status: 403 }) : inner(url))))
    expect(await loadDashArea(LOCATION, 1, { id: 'c1', name: 'South' })).toEqual([{ id: 's1', name: 'Open Store' }])
  })

  it('is the hierarchy featherbase.json declares, in a staff screen\'s words', () => {
    expect(DASH_AREAS.map(a => [a.name, a.levels.map(l => l.label)])).toEqual([['Location', ['Cluster', 'Store', 'Floor']], ['Merchandise', ['Division', 'Subdivision', 'Category', 'Subcategory']]])
  })

  it('reads none of them when Site cannot be described, offering nothing it cannot check', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith(':meta') ? new Response('', { status: 403 })
      : new Response(JSON.stringify({ data: SITES.map(({ row_id, name }) => ({ row_id, name })), total: 3 })))))
    expect(await loadDashArea(LOCATION, 1, { id: 'c1', name: 'South' })).toEqual([])
  })
})

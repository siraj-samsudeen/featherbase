// #1218: the business roles pages, rendered in a DOM (jsdom from apps/web) with the platform's answers
// played by a stand-in `fetch`; the reads themselves are proved in business-roles-server.test.ts and
// platform-test/business-roles.test.ts. Made-up people and stores.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../packages/shop-floor/node_modules/lucide-react', async importOriginal =>
  Object.fromEntries(Object.keys(await importOriginal<object>()).map(name => [name, () => null])))

type Call = { kind: string; name: string; payload: Record<string, unknown> }
const calls: Call[] = []
/** #1282: made-up places, as the platform's list read answers them. */
const TABLES: Record<string, Record<string, unknown>[]> = {
  Cluster: [{ row_id: 'cs', name: 'Chennai South' }, { row_id: 'no', name: 'North' }],
  Site: [{ row_id: 'SE', name: 'Store E', cluster: 'cs', is_store: 1 }, { row_id: 'SF', name: 'Store F', cluster: 'cs', is_store: 1 }, { row_id: 'WH', name: 'Warehouse', cluster: 'cs', is_store: 0 }],
  'Store Floor': [{ row_id: 'SE1', name: 'First floor', site: 'SE' }],
}
let answers: Record<string, unknown> = {}
let teardown: () => void = () => {}
let dom: { window: Record<string, unknown> & { close(): void } }

beforeAll(() => {
  const checkout = resolve(import.meta.dirname, '../../../..')
  const require = createRequire(resolve(checkout, 'apps/web/package.json'))
  const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options: { url: string }) => typeof dom }
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/dash/?view=explain&person=sm' })
  const added: string[] = []
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in globalThis) continue
    Object.defineProperty(globalThis, key, { configurable: true, get: () => dom.window[key] })
    added.push(key)
  }
  for (const key of ['window', 'document', 'navigator', 'location', 'history', 'localStorage'])
    Object.defineProperty(globalThis, key, { configurable: true, get: () => (key === 'window' ? dom.window : dom.window[key]) })
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).fetch = async (url: string, init: RequestInit) => {
    // #1282: the platform's list read, for the area picker's columns.
    const listed = /\/api\/table\/([^?]+)\?(.*)$/.exec(String(url))
    if (listed) {
      const query = new URLSearchParams(listed[2])
      const filters = JSON.parse(query.get('filters') ?? '[]') as [string, string, unknown][]
      const rows = (TABLES[decodeURIComponent(listed[1]!)] ?? []).filter(r => filters.every(([c, , v]) => r[c] === v))
      return new Response(JSON.stringify({ data: rows.slice(0, Number(query.get('limit_page_length') ?? 500)), total: rows.length }), { status: 200 })
    }
    const match = /app_(reads|actions)\/dash\/(.+)$/.exec(String(url))
    if (!match) return new Response('{}', { status: 404 })
    calls.push({ kind: match[1], name: match[2], payload: JSON.parse(String(init.body)).payload })
    const answer = answers[match[2]] as { __error?: string } | undefined
    if (answer?.__error) return new Response(JSON.stringify({ error: { message: answer.__error } }), { status: 417 })
    return new Response(JSON.stringify({ result: answers[match[2]] ?? (/^(manages|holds)_/.test(match[2]) ? false : []) }), { status: 200 })
  }
  teardown = () => { for (const key of added) delete (globalThis as Record<string, unknown>)[key]; dom.window.close() }
})
afterAll(() => teardown())

const NONE = { kinds: [], stores_gained: [], stores_lost: [], stores_changed: [], gained: [], lost: [], decisions: [] }
const SELVI = {
  person: 'sm', name: 'Selvi', who: { code: '3005', jobs: ['Store Manager · Lakeside'], staff: 'current' }, employee: '3005',
  header: { employee: [{ name: 'Selvi', table: 'Employee', id: '3005', code: '3005' }], sites: [{ name: 'Lakeside', table: 'Site', id: 'LKS' }], reports_to: [] },
  hr_titles: ['Operations Executive'],
  roles: [{ role: 'r-sm', name: 'Store Manager', source: 'From HR title', from: 'Store Manager', area: { parts: [{ name: 'Lakeside', table: 'Site', id: 'LKS' }], stores: 1, subcategories: null },
    until: null, reason: null, hand: null, hand_updated_at: null }],
  unmapped: [], apps: [{ app: 'Dash', level: 'Reader', via: ['Store Manager'] }, { app: 'Tasker', level: 'Manager', via: ['Store Manager'] }],
  reports: [{ key: 'vs', name: 'Vendor Sales', why: ['Given to Store Manager, for Lakeside'] }],
  today: { opens: true, reports: 1, stores: 1 }, next: { opens: true, reports: 1, stores: 1 }, change: NONE,
  choices: [{ id: 'r-sm', name: 'Store Manager' }, { id: 'r-tl', name: 'Team Leader' }],
  places: { stores: [{ id: 'HIL', name: 'Hillview' }, { id: 'LKS', name: 'Lakeside' }], default: 'LKS' },
}
beforeEach(() => { calls.length = 0; document.body.innerHTML = ''; answers = { explain_person: SELVI, give_role: { id: 'h1' } } })

async function render(element: 'explain' | 'roles' | 'changes') {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const pages = await import('./roles-page')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
  const Page = element === 'explain' ? pages.ExplainPersonPage : element === 'roles' ? pages.BusinessRolesPage : pages.AccessChangesPage
  await act(async () => { createRoot(container).render(<Page />) })
  await settle()
  const all = (testid: string) => [...container.querySelectorAll(`[data-testid="${testid}"]`)]
  const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }); await settle() }
  const set = async (element: HTMLInputElement | HTMLSelectElement, value: string) => {
    await act(async () => {
      const proto = element instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
      element.dispatchEvent(new window.Event(element instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    })
    await settle()
  }
  return { container, all, click, set }
}

describe('Explain A Person', () => {
  it('shows a role with its area and source chip', async () => {
    const { all } = await render('explain')
    expect(all('explain-role').map(line => [line.querySelector('[data-testid="role-area"]')!.textContent, line.querySelector('[data-testid="source-chip"]')!.textContent]))
      .toEqual([['Lakeside', 'From HR title']])
  })

  it('opens a report\'s Why? only when asked', async () => {
    const { all, click } = await render('explain')
    const report = all('explain-report')[0]
    const before = report.querySelectorAll('[data-testid="why-line"]').length
    await click(report.querySelector('[data-testid="why-toggle"]')!)
    expect([before, all('explain-report')[0].querySelector('[data-testid="why-line"]')!.textContent]).toEqual([0, 'Given to Store Manager, for Lakeside'])
  })

  it('reads the designation as the HR title, with Employee and Site chips in the header', async () => {
    const { all } = await render('explain')
    expect([all('hr-title')[0].textContent, all('header-chip').map(c => c.textContent)]).toEqual(['Operations Executive', ['Employee Selvi 3005', 'Site Lakeside']])
  })

  it('draws the source chip in the action tint', async () => {
    const { all } = await render('explain')
    expect(all('source-chip')[0].getAttribute('data-tone')).toBe('source')
  })

  it('says the new model gives the same when nothing changes', async () => {
    const { all } = await render('explain')
    expect(all('explain-change')[0].textContent).toBe('Nothing: the new model gives the same.')
  })

  it('also gives a role with an end date, then reads the person again', async () => {
    const { all, click, set } = await render('explain')
    await click(all('also-give-button')[0])
    await set(all('hand-role')[0] as HTMLSelectElement, 'r-tl')
    await set(all('hand-ends')[0] as HTMLInputElement, '2027-03-31')
    await click(all('hand-save')[0])
    expect([calls.find(c => c.name === 'give_role')?.payload, calls.filter(c => c.name === 'explain_person').length])
      .toEqual([{ person: 'sm', change: 'Also give', role: 'r-tl', site: 'LKS', ends_on: '2027-03-31', reason: '' }, 2])
  })

  // #1282 G1: the place picked on the trees, a store; a cluster shows but cannot be given yet.
  it('picks the place on the trees: a cluster walks to its stores, and a store becomes the place', async () => {
    const { all, click, set } = await render('explain')
    await click(all('also-give-button')[0])
    await set(all('hand-role')[0] as HTMLSelectElement, 'r-tl')
    await click(all('hand-pick-area')[0])
    const button = (text: string) => [...document.querySelectorAll('[data-testid="area-picker"] button')].find(b => b.textContent?.startsWith(text))!
    // Two stores under Chennai South: its warehouse is no store.
    expect(button('Chennai South').textContent).toBe('Chennai South2 stores')
    await click(button('Chennai South'))
    expect(all('area-not-yet')[0].textContent).toBe('Can be given at Store level for now')
    expect((button('Use Chennai South') as HTMLButtonElement).disabled).toBe(true)
    await click(button('Store E'))
    await click(button('Use Store E'))
    expect([all('area-picker').length, all('hand-sentence')[0].textContent]).toEqual([0, 'Also give: treat as Team Leader at Store E.'])
    await click(all('hand-save')[0])
    expect(calls.find(c => c.name === 'give_role')?.payload).toMatchObject({ site: 'SE' })
  })

  it('offers the job\'s place by default in a Correct, said as a sentence', async () => {
    const { all, click, set } = await render('explain')
    await click(all('correct-button')[0])
    await set(all('hand-role')[0] as HTMLSelectElement, 'r-sm')
    expect([(all('hand-site')[0] as HTMLSelectElement).value, all('hand-sentence')[0].textContent]).toEqual(['LKS', 'Correct: treat as Store Manager at Lakeside.'])
  })

  it('lists only the decisions the comparison makes', async () => {
    answers.explain_person = { ...SELVI, change: { ...NONE, kinds: ['decision'], decisions: [{ name: 'Sales', table: 'dash.report', id: 'sales' }] } }
    const { all } = await render('explain')
    expect(all('explain-decision').map(l => l.textContent)).toEqual(['Sales'])
  })

  it('says plainly that only a manager may see it, with no search above', async () => {
    answers = { explain_person: { __error: 'Only a Report Access Manager or a System Manager can see business roles' } }
    const { all } = await render('explain')
    expect([all('refused')[0].textContent!.includes('Only a Report Access Manager or System Manager can see this'), all('person-search').length]).toEqual([true, 0])
  })

  // #1316: with no person chosen there is no explanation to refuse; the page asks first whether this viewer may use it.
  it('refuses plainly before anyone is chosen, to someone who may not use it', async () => {
    window.history.replaceState(null, '', '/dash/?view=explain')
    try {
      answers = { manages_roles: false }
      const refused = await render('explain')
      expect([refused.all('refused').length, refused.all('person-search').length]).toEqual([1, 0])
      answers = { manages_roles: true }
      const allowed = await render('explain')
      expect([allowed.all('refused').length, allowed.all('person-search').length]).toEqual([0, 1])
    } finally { window.history.replaceState(null, '', '/dash/?view=explain&person=sm') }
  })

  it('reads No current job as the HR title of someone with none', async () => {
    answers.explain_person = { ...SELVI, hr_titles: [] }
    const { all } = await render('explain')
    expect(all('hr-title')[0].textContent).toBe('No current job')
  })

  it('asks on the line before removing a hand change, and keeps it on Keep', async () => {
    const given = { ...SELVI.roles[0], source: 'Also given by hand', hand: 'h1', hand_updated_at: 'u' }
    answers.explain_person = { ...SELVI, roles: [given] }
    const { all, click } = await render('explain')
    await click(all('remove-role')[0])
    const asked = all('remove-confirm')[0].textContent
    await click(all('remove-keep')[0])
    expect([asked, calls.some(c => c.name === 'remove_role'), all('remove-role').length]).toEqual(['Remove this?YesKeep', false, 1])
  })

  it('removes a hand change on Yes', async () => {
    const given = { ...SELVI.roles[0], source: 'Also given by hand', hand: 'h1', hand_updated_at: 'u' }
    answers.explain_person = { ...SELVI, roles: [given] }
    answers.remove_role = { removed: 'h1' }
    const { all, click } = await render('explain')
    await click(all('remove-role')[0])
    await click(all('remove-yes')[0])
    expect(calls.find(c => c.name === 'remove_role')?.payload).toEqual({ id: 'h1', updated_at: 'u' })
  })

  it('says whether they are an Employee, a Former Employee or External', async () => {
    const { all } = await render('explain')
    expect(all('staff-badge').map(b => b.textContent)).toEqual(['Employee'])
  })
})

describe('Business Roles', () => {
  const ROLES = { business_roles: {
    roles: [{ id: 'r-sm', name: 'Store Manager', description: 'Runs a store.', by_hand_only: false, reaches: 'their store', permissions: [
      { app: 'Dash', level: 'Manager', verb: 'Edit', thing: 'Sections', reach: 'Area', sentence: 'Store Managers can Edit Sections in their area',
        parts: [{ record: { table: 'dash.business_role', row: 'r-sm', name: 'Store Managers' } }, ' can Edit Sections ', { chip: 'in their area' }] },
      { app: 'Dash', level: 'Manager', verb: 'Give', thing: 'Reports', reach: 'Team', sentence: 'Store Managers can Give Reports for their team',
        parts: [{ record: { table: 'dash.business_role', row: 'r-sm', name: 'Store Managers' } }, ' can Give Reports ', { chip: 'for their team' }] }],
      reports: [[{ record: { table: 'dash.report', row: 'vs', name: 'Visit Sales' } }, ' is given to ', { record: { table: 'dash.business_role', row: 'r-sm', name: 'Store Manager' } }, ' ', { chip: 'each in their own area' }]],
      people: 25, people_from: 'from HR title and by hand', holders: [{ person: 'p1', name: 'Sundar' }] }],
    titles: [{ title: 'Operations Executive', role: null, role_name: null, people: 3, falls_back_to: 'Store Manager', holders: [{ person: 'p1', name: 'Sundar' }] },
      { title: 'Store Manager', role: 'r-sm', role_name: 'Store Manager', people: 4, holders: [] }],
  } }

  // #1277: which rules decide, the old grants given to business roles only when a System Manager asks, and what was done.
  it('says the old rules decide, and gives the old grants to business roles only on a System Manager\'s click', async () => {
    answers = { ...ROLES, access_source: { source: 'legacy', switch_rows: [], can_switch: true }, give_old_grants_to_roles: { grants_added: 0 } }
    const { all, click } = await render('roles')
    expect(all('access-source-line')[0].textContent).toContain('decided by the old rules')
    expect(calls.filter(c => c.kind === 'actions')).toEqual([])
    await click(all('give-old-grants')[0])
    expect(calls.filter(c => c.kind === 'actions').map(c => c.name)).toEqual(['give_old_grants_to_roles'])
  })

  it('says business roles decide once switched, offers nothing to someone who is not a System Manager, and lists what was done', async () => {
    answers = { ...ROLES, access_source: { source: 'business_roles', switch_rows: [{ id: 's1', source: 'business_roles' }], can_switch: false },
      switch_over_log: [{ id: 'l1', step: 'Report grant', outcome: 'Added', detail: 'Gave report vs to Store Manager, as it was given to the job Store Manager' }] }
    const { all, click } = await render('roles')
    expect([all('access-source-line')[0].textContent!.includes('decided by business roles'), all('give-old-grants').length]).toEqual([true, 0])
    await click(all('switch-over-log-toggle')[0])
    expect(all('switch-over-log')[0].textContent).toContain('Gave report vs to Store Manager')
  })

  it('opens a role as a grid: things as rows, a reach chip under its verb, other verbs on the row', async () => {
    answers = ROLES
    const { all, click } = await render('roles')
    await click(all('role-open')[0])
    expect(all('grid-row').map(row => [row.querySelector('[data-testid="cell-Edit"]')!.textContent, row.textContent!.includes('Give')]))
      .toEqual([['Area', false], ['—', true]])
  })

  // #1282 H1–H4: the role said as sentences, each record a link and its reach a chip; its people counted, with where they come from.
  it('says a role in sentences: a header with its people, its permissions and the reports given to it', async () => {
    answers = ROLES
    const { all, click } = await render('roles')
    expect(all('role-header')[0].textContent).toBe('Business role · 25 people · from HR title and by hand')
    await click(all('role-people')[0])
    expect([all('role-holders')[0].textContent, all('role-holders')[0].querySelector('a')!.getAttribute('href')]).toEqual(['Sundar and 24 more', '?view=explain&person=p1'])
    await click(all('role-open')[0])
    expect(all('permission-line').map(l => [l.textContent, l.querySelector('[data-testid="sentence-reach"]')!.textContent])).toEqual([
      ['Store Managers can Edit Sections in their area', 'in their area'], ['Store Managers can Give Reports for their team', 'for their team']])
    expect(all('report-line').map(l => l.textContent)).toEqual(['Visit Sales is given to Store Manager each in their own area'])
  })

  it('says a role nobody holds, with no permissions yet, still with the reports given to it', async () => {
    answers = { business_roles: { ...ROLES.business_roles, roles: [{ ...ROLES.business_roles.roles[0]!, permissions: [], people: 0, people_from: 'nobody yet', holders: [] }] } }
    const { all, click } = await render('roles')
    await click(all('role-people')[0])
    await click(all('role-open')[0])
    expect([all('role-header')[0].textContent, all('role-holders')[0].textContent, all('report-line').length, all('role-line')[0].textContent!.includes('No permissions yet.')])
      .toEqual(['Business role · 0 people · nobody yet', 'Nobody holds it yet.', 1, true])
  })

  it('says how far a role reaches in plain words', async () => {
    answers = ROLES
    const { all } = await render('roles')
    expect(all('role-reaches')[0].textContent).toBe('Reaches: their store')
  })

  it('colours each reach by its word', async () => {
    answers = ROLES
    const { all, click } = await render('roles')
    await click(all('role-open')[0])
    expect(all('reach-chip').map(c => [c.textContent, c.className.includes('positive') || c.className.includes('action')])).toEqual([['Area', true], ['Team', true]])
  })

  it('lists titles not mapped yet first, and opens who holds one', async () => {
    answers = ROLES
    const { all, click } = await render('roles')
    await click(all('unmapped-line')[0].querySelector('[data-testid="holders-toggle"]')!)
    expect([all('unmapped-line').map(l => l.querySelector('.font-medium')!.textContent), all('holders')[0].querySelector('a')!.getAttribute('href')])
      .toEqual([['Operations Executive'], '?view=explain&person=p1'])
  })
})

describe('Who Would Gain Or Lose Access', () => {
  it('lists only people with a difference, with a count per kind', async () => {
    answers = { access_changes: { people: 3, changed: 1, groups: [
      { kind: 'loses_dash', people: [{ person: 'st', name: 'Siva', who: null, kinds: ['loses_dash'], roles: ['Staff'], stores_gained: [], stores_lost: [], stores_changed: [], gained: [], lost: [], decisions: [] }] },
      { kind: 'gains_dash', people: [] }, { kind: 'stores', people: [] }, { kind: 'reports', people: [] }, { kind: 'decision', people: [] }] } }
    const { all } = await render('changes')
    expect([all('changed-name').map(a => [a.textContent, a.getAttribute('href')]), all('group-loses_dash-count')[0].textContent])
      .toEqual([[['Siva', '?view=explain&person=st']], '1'])
  })

  // #1277: a role viewing every report is said in plain words, not report by report.
  it('says every report, through Owner Director, instead of listing each report gained', async () => {
    const report = (name: string) => ({ name, table: 'dash.report', id: name })
    answers = { access_changes: { people: 1, changed: 1, groups: [
      { kind: 'reports', people: [{ person: 'od', name: 'Omana', who: null, kinds: ['reports'], roles: ['Owner Director'], stores_gained: [], stores_lost: [], stores_changed: [],
        gained: [report('Sales'), report('Stock')], lost: [], decisions: [], every_report: ['Owner Director'] }] }] } }
    const { all } = await render('changes')
    expect(all('change-fact').map(f => f.textContent)).toEqual(['Would get every report, through Owner Director'])
  })

  // #1277 (decision 7): each old grant left where it is, with who would lose its reports.
  it('lists each grant not carried over, with the people who would lose its reports, each a link', async () => {
    const vs = { name: 'Vendor Sales', table: 'dash.report', id: 'vs' }
    answers = { access_changes: { people: 2, changed: 1, groups: [], not_carried_over: [
      { grant: 'a1', gives: vs, receiver: { kind: 'job', name: 'Store Manager' }, note: 'Not carried over: add on request', people: [{ person: 'sm', name: 'Selvi', reports: [vs] }] },
      { grant: 'a8', gives: { name: 'Store pack', table: 'dash.report_bundle', id: 'b1' }, receiver: { kind: 'role', name: 'Dash All-Stores Reader' }, note: 'Not carried over: add on request', people: [] }] } }
    const { all } = await render('changes')
    expect([all('not-carried-over-count')[0].textContent, all('not-carried-grant').map(l => l.textContent), all('not-carried-person').map(a => [a.textContent, a.getAttribute('href')])]).toEqual([
      '2',
      ['Vendor Sales · to the job Store Manager', 'Store pack · to the role Dash All-Stores Reader'],
      [['Selvi', '?view=explain&person=sm']]])
    expect(all('not-carried-people').map(p => p.textContent)).toEqual(['Not carried over: add on request. Would lose Vendor Sales: Selvi', 'Not carried over: add on request. Nobody would lose a report'])
  })
})

describe('a bundle\'s record link', () => {
  it('opens Report access on that bundle, marked', async () => {
    const { showBundleInAddress } = await import('./access-page')
    window.history.replaceState(null, '', '/dash/?view=access&section=bundles&bundle=b2')
    document.body.innerHTML = '<div data-bundle-id="b1"></div><div data-bundle-id="b2"></div>'
    showBundleInAddress()
    expect([...document.querySelectorAll('[aria-current]')].map(el => el.getAttribute('data-bundle-id'))).toEqual(['b2'])
  })

  it('marks nothing when the address names no bundle', async () => {
    const { showBundleInAddress } = await import('./access-page')
    window.history.replaceState(null, '', '/dash/?view=access')
    document.body.innerHTML = '<div data-bundle-id="b1"></div>'
    showBundleInAddress()
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(0)
  })
})

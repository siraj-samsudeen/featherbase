// Your department (#1195) and the reviewer's set-up cards, rendered in a DOM (jsdom from apps/web), with
// the platform's answers played by a stand-in `fetch`. The rules are proved in department-setup.test.ts
// and on the real platform. Made-up people and stores.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Shop Floor's icons come with the workspace's copy of React; the real page bundles one. An icon
// says nothing these tests read, so here each draws nothing.
vi.mock('../../../../packages/shop-floor/node_modules/lucide-react', async importOriginal =>
  Object.fromEntries(Object.keys(await importOriginal<object>()).map(name => [name, () => null])))

type Call = { kind: 'reads' | 'actions'; name: string; payload: Record<string, unknown> }
const calls: Call[] = []
let answers: Record<string, unknown> = {}
let teardown: () => void = () => {}

beforeAll(() => {
  const checkout = resolve(import.meta.dirname, '../../../..')
  const require = createRequire(resolve(checkout, 'apps/web/package.json'))
  const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options: { url: string }) => { window: Record<string, unknown> & { close(): void } } }
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/dash/?view=department' })
  const added: string[] = []
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (key in globalThis) continue
    Object.defineProperty(globalThis, key, { configurable: true, get: () => dom.window[key] })
    added.push(key)
  }
  for (const key of ['window', 'document', 'navigator', 'location', 'history'])
    Object.defineProperty(globalThis, key, { configurable: true, get: () => (key === 'window' ? dom.window : dom.window[key]) })
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).fetch = async (url: string, init: RequestInit) => {
    const [, kind, name] = /app_(reads|actions)\/dash\/(.+)$/.exec(String(url))!
    const body = JSON.parse(String(init.body))
    calls.push({ kind: kind as Call['kind'], name, payload: body.payload })
    const answer = name === 'reports' || name === 'department_approvals' ? answers[name] ?? [] : answers[name]
    if (answer instanceof Error) return new Response(JSON.stringify({ error: { message: answer.message } }), { status: 417 })
    return new Response(JSON.stringify({ result: answer ?? { state: 'ok', proposals: [] } }), { status: 200 })
  }
  teardown = () => { for (const key of added) delete (globalThis as Record<string, unknown>)[key]; dom.window.close() }
})
afterAll(() => teardown())
beforeEach(() => { calls.length = 0; answers = {}; document.body.innerHTML = '' })

async function render(page: 'YourDepartment' | 'Approvals') {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const Page = page === 'Approvals' ? (await import('./sections-page')).Approvals : (await import('./department-page')).YourDepartment
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<Page />) })
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
  const q = (testid: string) => container.querySelector(`[data-testid="${testid}"]`)
  const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label) as HTMLButtonElement
  const click = async (label: string) => {
    await act(async () => { button(label).dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
  }
  const choose = async (element: HTMLSelectElement | HTMLInputElement, value: string) => {
    const proto = element instanceof window.HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
      element.dispatchEvent(new window.Event(element instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    })
  }
  /** Clicks an element no label names uniquely, such as one of several Undo buttons. */
  const press = async (element: Element) => {
    await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })
  }
  return { container, q, button, click, press, choose, done: () => act(async () => root.unmount()) }
}


const section = (id: string, name: string, floor: string, over: Record<string, unknown> = {}) =>
  ({ id, name, floor, sells: [], more: 0, team_leaders: [], suggested: false, held_by: null, ...over })
const SETUP = {
  state: 'ok', name: 'Deepa', job: { id: 'J1', store: 'Lakeside' }, reviewer: 'Mani',
  floors: [{ id: 'F1', name: 'First floor' }, { id: 'F2', name: 'Second floor' }, { id: '', name: 'No floor' }], start_floors: ['F1'],
  sections: [
    section('S5', 'Bags', 'F1', { team_leaders: ['Kavya'] }),
    section('S1', 'Sarees', 'F1', { sells: ['Banarasi sarees', 'Cotton sarees', 'Kanchi sarees'], more: 1, team_leaders: ['Asha'], suggested: true }),
    section('S2', 'Silk', 'F1', { sells: ['Salwar sets'], team_leaders: ['Bala', 'Siva'], suggested: true }),
    section('S6', 'Footwear', 'F2'),
    section('S3', 'Kids Wear', 'F2', { team_leaders: ['Ravi'], suggested: true, held_by: 'Kids (Arun)' }),
    section('S7', 'Loose', ''),
  ],
  names: ['Footwear and Bags', 'Menswear'], current: null,
}
const rows = (container: Element) => [...container.querySelectorAll('[data-testid=section-row]')].map(row => {
  const box = row.querySelector('input') as HTMLInputElement
  return `${box.checked ? '[x]' : '[ ]'}${box.disabled ? ' (held)' : ''} ${row.textContent}`
})
const sentCalls = (name: string) => calls.filter(c => c.kind === 'actions' && c.name === name).map(c => c.payload)

describe('sellsLine', () => {
  it('names three things, then how many more, or says nothing is placed', async () => {
    const { sellsLine } = await import('./department-page')
    expect(sellsLine({ sells: ['A', 'B', 'C'], more: 2 })).toBe('Sells A, B, C and 2 more')
    expect(sellsLine({ sells: ['A'], more: 0 })).toBe('Sells A')
    expect(sellsLine({ sells: [], more: 0 })).toBe('Nothing placed here yet')
  })
})

describe('startLayout', () => {
  it('reads the address, then what was chosen last, else Steps', async () => {
    const { startLayout } = await import('./department-page')
    window.localStorage.clear()
    expect(startLayout('')).toBe('steps')
    expect(startLayout('?layout=wizard')).toBe('wizard')
    expect(startLayout('?layout=nonsense')).toBe('steps')
    window.localStorage.setItem('dash.department-layout', 'list')
    expect(startLayout('')).toBe('list')
    window.localStorage.clear()
  })
  it('falls back to Steps when the browser keeps nothing', async () => {
    const { startLayout } = await import('./department-page')
    const spy = vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => { throw new Error('private window') })
    expect(startLayout('')).toBe('steps')
    spy.mockRestore()
  })
})

describe('Your department', () => {
  beforeEach(() => window.localStorage.clear())

  it.each([
    [{ state: 'not_set_up' }, 'not-set-up', "This isn't set up here yet"],
    [{ state: 'unknown_person' }, 'unknown-person', "We can't find you on the staff list yet"],
    [{ state: 'no_job' }, 'no-job', 'This page is for Department Managers'],
    [{ state: 'no_sections', job: { id: 'J1', store: 'Riverside' }, reviewer: 'Mani' }, 'no-sections', "Riverside's sections aren't set up yet"],
  ])('says so for %j', async (answer, testid, text) => {
    answers.department_setup = answer
    const page = await render('YourDepartment')
    expect(page.q(testid)?.textContent).toContain(text)
    expect(page.q('department-link')?.getAttribute('aria-current')).toBe('page')
    await page.done()
  })
  it('offers Try again when it cannot load', async () => {
    answers.department_setup = new Error('offline')
    const page = await render('YourDepartment')
    expect(page.button('Try again')).toBeTruthy()
    await page.done()
  })

  it('starts on the floor of their Team Leaders, with those sections ticked and what each sells', async () => {
    answers.department_setup = SETUP
    const page = await render('YourDepartment')
    expect(page.q('intro')?.textContent).toBe('Deepa · Department Manager at Lakeside.')
    expect(page.q('layout-steps')?.textContent).toContain("Your Team Leaders' sections are on the First floor.")
    expect(rows(page.container)).toEqual([
      '[ ] Bags · First floorNothing placed here yetTeam Leader: Kavya',
      '[x] Sarees · First floorSells Banarasi sarees, Cotton sarees, Kanchi sarees and 1 moreTeam Leader: AshaYour Team Leader runs it',
      '[x] Silk · First floorSells Salwar setsTeam Leader: Bala and SivaYour Team Leader runs it',
    ])
    expect((page.q('send') as HTMLButtonElement).disabled).toBe(true)
    expect(page.q('summary')?.textContent).toBe('2 sections. Nothing changes until Mani keeps it.')
    await page.done()
  })

  it('shows another floor, where a section another department holds cannot be ticked', async () => {
    answers.department_setup = SETUP
    const page = await render('YourDepartment')
    await page.click('Second floor')
    expect(rows(page.container).slice(3)).toEqual([
      '[ ] Footwear · Second floorNothing placed here yetNo Team Leader',
      '[ ] (held) Kids Wear · Second floorNothing placed here yetTeam Leader: RaviAlready in Kids (Arun). Ask Mani if it should move to you.',
    ])
    await page.click('First floor')
    await page.click('Second floor')
    expect(page.q('no-floor-chosen')?.textContent).toBe('Choose a floor to see its sections.')
    await page.done()
  })

  it('sends the ticked sections and the name, then shows it waiting', async () => {
    answers.department_setup = SETUP
    const page = await render('YourDepartment')
    const footwear = () => [...page.container.querySelectorAll('input[type=checkbox]')].find(b => b.getAttribute('aria-label') === 'Bags') as HTMLInputElement
    await page.press(footwear())
    await page.click('Menswear')
    expect(page.q('summary')?.textContent).toBe('3 sections · Menswear. Nothing changes until Mani keeps it.')
    await page.choose(page.q('name-input') as HTMLInputElement, '  Ladies Ethnic ')
    answers.set_up_department = { state: 'waiting' }
    answers.department_setup = { ...SETUP, current: { state: 'waiting', bundle: 'B1', name: 'Ladies Ethnic', sections: ['Bags', 'Sarees', 'Silk'], waiting_for: 'Mani', asked_on: '2026-11-11' } }
    await page.click('Send to Mani')
    expect(sentCalls('set_up_department')).toEqual([{ job: 'J1', name: 'Ladies Ethnic', sections: ['S5', 'S1', 'S2'] }])
    expect(page.q('sent-note')?.textContent).toBe('Sent to Mani. Your report opens as soon as it is kept.')
    expect(page.q('waiting')?.textContent).toContain('Bags, Sarees and Silk')
    expect(page.q('waiting')?.textContent).toContain('Sent on 11-Nov-2026')
    await page.done()
  })

  it('clears a refusal as soon as they change anything', async () => {
    answers.department_setup = SETUP
    answers.set_up_department = new Error('Lakeside already has a department called Kids')
    const page = await render('YourDepartment')
    await page.choose(page.q('name-input') as HTMLInputElement, 'Kids')
    await page.click('Send to Mani')
    await page.click('Menswear')
    expect(page.q('refused')).toBeNull()
    await page.click('Send to Mani')
    await page.press([...page.container.querySelectorAll('input[type=checkbox]')].find(b => b.getAttribute('aria-label') === 'Bags')!)
    expect(page.q('refused')).toBeNull()
    await page.click('Send to Mani')
    await page.click('Second floor')
    expect(page.q('refused')).toBeNull()
    await page.done()
  })
  it('words a master data team reviewer as a sentence, with no one to be away', async () => {
    answers.department_setup = { ...SETUP, reviewer: 'the master data team', reviewer_is_team: true, current: { state: 'waiting', bundle: 'B1', name: 'Ladies', sections: ['Sarees'], waiting_for: 'the master data team', asked_on: '2026-11-11' } }
    const page = await render('YourDepartment')
    expect(page.q('waiting')?.textContent).toContain('Sent on 11-Nov-2026.Change it')
    await page.click('Change it')
    expect(page.q('lead')?.textContent).toContain('The master data team reviews it')
    await page.done()
  })
  it('shows a refusal and keeps what they chose', async () => {
    answers.department_setup = SETUP
    answers.set_up_department = new Error('Lakeside already has a department called Kids')
    const page = await render('YourDepartment')
    await page.choose(page.q('name-input') as HTMLInputElement, 'Kids')
    await page.click('Send to Mani')
    expect(page.q('refused')?.textContent).toBe('Lakeside already has a department called Kids')
    expect((page.q('name-input') as HTMLInputElement).value).toBe('Kids')
    await page.done()
  })

  it('withdraws a waiting set-up, or changes it in place, keeping it until the new one is sent', async () => {
    const waiting = { ...SETUP, current: { state: 'waiting', bundle: 'B1', name: 'Ladies Ethnic', sections: ['Sarees'], waiting_for: 'Mani', asked_on: '2026-11-11' } }
    answers.department_setup = waiting
    answers.withdraw_department = { withdrawn: 2 }
    const page = await render('YourDepartment')
    await page.click('Change it')
    expect(sentCalls('withdraw_department')).toEqual([])
    expect(page.q('lead')?.textContent).toContain('What you send replaces the one waiting.')
    await page.click('Step by step')
    expect(page.q('cancel-change')).toBeTruthy()
    await page.click('Cancel')
    expect(page.q('waiting')).toBeTruthy()
    await page.click('Change it')
    await page.click('Steps')
    await page.click('Cancel')
    expect(page.q('waiting')).toBeTruthy()
    await page.click('Change it')
    expect((page.q('name-input') as HTMLInputElement).value).toBe('Ladies Ethnic')
    expect(rows(page.container).filter(r => r.startsWith('[x]'))).toEqual(['[x] Sarees · First floorSells Banarasi sarees, Cotton sarees, Kanchi sarees and 1 moreTeam Leader: AshaYour Team Leader runs it'])
    answers.set_up_department = { state: 'waiting' }
    await page.click('Send to Mani')
    expect(sentCalls('set_up_department')).toEqual([{ job: 'J1', name: 'Ladies Ethnic', sections: ['S1'], replaces: 'B1' }])
    expect(page.q('waiting')).toBeTruthy()
    await page.done()

    answers.department_setup = waiting
    const again = await render('YourDepartment')
    answers.department_setup = SETUP
    await again.click('Withdraw')
    expect(again.q('note')?.textContent).toBe('Withdrawn. Nothing was changed.')
    await again.click('Menswear')
    expect(again.q('note')).toBeNull()
    await again.done()
  })
  it('says why a withdrawal failed', async () => {
    answers.department_setup = { ...SETUP, current: { state: 'waiting', bundle: 'B1', name: 'Ladies', sections: ['Sarees'], waiting_for: 'Mani', asked_on: '2026-11-11' } }
    answers.withdraw_department = new Error('That set-up is no longer waiting')
    const page = await render('YourDepartment')
    await page.click('Withdraw')
    expect(page.q('note')?.textContent).toBe('That set-up is no longer waiting')
    await page.done()
  })

  it('says why the last one was turned down, with it filled in to send again', async () => {
    answers.department_setup = { ...SETUP, start_floors: ['F1', 'F2'], current: { state: 'turned_down', name: 'Ladies', sections: ['Silk'], reason: 'Sarees is in Ethnic.' } }
    const page = await render('YourDepartment')
    expect(page.q('turned-down')?.textContent).toBe("Mani didn't keep “Ladies”: Sarees is in Ethnic. Change it and send it again.")
    expect(page.q('summary')?.textContent).toBe('1 section · Ladies. Nothing changes until Mani keeps it.')
    expect(page.q('layout-steps')?.textContent).not.toContain("Your Team Leaders' sections are on")
    await page.done()
  })
  it('says a turn-down with no reason plainly', async () => {
    answers.department_setup = { ...SETUP, current: { state: 'turned_down', name: 'Ladies', sections: [], reason: '' } }
    const page = await render('YourDepartment')
    expect(page.q('turned-down')?.textContent).toBe("Mani didn't keep “Ladies”. Change it and send it again.")
    await page.done()
  })

  it('shows the department they have as kept, and the way to their report', async () => {
    answers.department_setup = { ...SETUP, current: { state: 'set_up', name: 'Ladies Ethnic', sections: ['Sarees', 'Silk'] } }
    const page = await render('YourDepartment')
    expect(page.q('set-up')?.textContent).toContain('Ladies Ethnic · LakesideKept')
    expect(page.q('set-up')?.textContent).toContain('Sarees and Silk')
    expect(page.q('open-report')?.getAttribute('href')).toBe('?')
    await page.done()
  })

  it('One list groups the sections under each chosen floor, and remembers the choice', async () => {
    answers.department_setup = { ...SETUP, names: [] }
    const page = await render('YourDepartment')
    await page.click('One list')
    expect(window.localStorage.getItem('dash.department-layout')).toBe('list')
    expect(page.q('names')).toBeNull()
    await page.click('Second floor')
    await page.click('No floor')
    expect([...page.q('layout-list')!.querySelectorAll('h3')].map(h => h.textContent)).toEqual(['First floor', 'Second floor', 'No floor'])
    await page.click('No floor')
    await page.click('First floor')
    await page.click('Second floor')
    expect(page.q('no-floor-chosen')).toBeTruthy()
    await page.done()
  })

  it('Step by step walks floor, sections, then name, and back', async () => {
    answers.department_setup = SETUP
    const page = await render('YourDepartment')
    await page.click('Step by step')
    expect(page.q('wizard-step')?.textContent).toBe('Step 1 of 3')
    await page.click('Next')
    expect(page.q('layout-wizard')?.textContent).toContain('Tick your sections')
    for (const name of ['Sarees', 'Silk']) await page.press([...page.container.querySelectorAll('input[type=checkbox]')].find(b => b.getAttribute('aria-label') === name)!)
    expect((page.q('next') as HTMLButtonElement).disabled).toBe(true)
    await page.press([...page.container.querySelectorAll('input[type=checkbox]')].find(b => b.getAttribute('aria-label') === 'Bags')!)
    await page.click('Next')
    expect(page.q('wizard-sections')?.textContent).toBe('Bags')
    expect(page.q('send')).toBeTruthy()
    await page.click('Back')
    await page.click('Back')
    expect(page.q('wizard-step')?.textContent).toBe('Step 1 of 3')
    await page.done()
  })
})

describe('Waiting for your approval: set-ups', () => {
  const SETUP_WAITING = { bundle: 'B1', who: 'Deepa', job: 'Department Manager', store: 'Lakeside', name: 'Ladies Ethnic', asked_on: '2026-11-11',
    sections: [{ id: 'S1', name: 'Sarees', team_leaders: ['Asha'] }, { id: 'S2', name: 'Silk', team_leaders: [] }] }
  beforeEach(() => { answers.approvals = { state: 'ok', proposals: [] } })

  it('shows each set-up with its sections, counts it, and keeps it', async () => {
    answers.department_approvals = [SETUP_WAITING]
    answers.decide_department = { state: 'Applied' }
    const page = await render('Approvals')
    expect(page.q('setup-ask')?.textContent).toBe('Set up “Ladies Ethnic” at Lakeside')
    expect(page.q('setup-sections')?.textContent).toBe('Sarees · Team Leader AshaSilk · no Team Leader')
    expect(page.q('approvals-link')?.textContent).toContain('(1)')
    expect(page.q('nothing-waiting')).toBeNull()
    answers.department_approvals = []
    await page.click('Keep it')
    expect(sentCalls('decide_department')).toEqual([{ bundle: 'B1', decision: 'approve' }])
    expect(page.q('decision-note')?.textContent).toBe("Kept. Deepa's report now shows these sections.")
    expect(page.q('nothing-waiting')).toBeTruthy()
    await page.done()
  })

  it('changes the name and sections before keeping, or cancels', async () => {
    answers.department_approvals = [SETUP_WAITING]
    answers.decide_department = { state: 'Applied' }
    const page = await render('Approvals')
    await page.click('Change, then keep')
    await page.click('Cancel')
    await page.click('Change, then keep')
    await page.choose(page.q('change-name') as HTMLInputElement, 'Ethnic Wear ')
    await page.press([...page.container.querySelectorAll('input[type=checkbox]')].find(b => b.getAttribute('aria-label') === 'Silk')!)
    await page.click('Keep with changes')
    expect(sentCalls('decide_department')).toEqual([{ bundle: 'B1', decision: 'approve', name: 'Ethnic Wear', sections: ['S1'] }])
    await page.done()
  })

  it('says the maker sees the reason once it is turned down', async () => {
    answers.department_approvals = [SETUP_WAITING]
    answers.decide_department = { state: 'Rejected' }
    const page = await render('Approvals')
    await page.click('Turn down')
    await page.choose(page.q('reject-reason') as HTMLInputElement, 'Bags is in Kids')
    answers.department_approvals = []
    await page.click('Turn it down')
    expect(page.q('decision-note')?.textContent).toBe('Turned down. Deepa sees your reason.')
    await page.done()
  })
  it('turns it down only with a reason, and shows a refusal', async () => {
    answers.department_approvals = [SETUP_WAITING]
    answers.decide_department = new Error('That set-up is no longer waiting')
    const page = await render('Approvals')
    await page.click('Turn down')
    expect((page.q('confirm-reject') as HTMLButtonElement).disabled).toBe(true)
    await page.click('Cancel')
    await page.click('Turn down')
    await page.choose(page.q('reject-reason') as HTMLInputElement, ' Bags is in Kids ')
    await page.click('Turn it down')
    expect(sentCalls('decide_department')).toEqual([{ bundle: 'B1', decision: 'reject', reason: 'Bags is in Kids' }])
    expect(page.q('decision-note')).toBeNull()
    expect(page.q('decide-refused')?.textContent).toBe('That set-up is no longer waiting')
    await page.done()
  })
})

describe('apply now, review after (#1191), when it is switched on', () => {
  it('says the department is in use and who has yet to review it', async () => {
    answers.department_setup = { ...SETUP, current: { state: 'set_up', name: 'Ladies Ethnic', sections: ['Sarees'], reviewing: { bundle: 'B1', waiting_for: 'the master data team' } } }
    const page = await render('YourDepartment')
    expect(page.q('set-up')?.textContent).toContain('In use, the master data team to review')
    expect(page.q('reviewing')?.textContent).toBe('Your report shows these sections now. The master data team will look at it, and can undo it.')
    await page.done()
  })
  it('lets the reviewer keep it or undo it, with no new name for a department in use', async () => {
    answers.approvals = { state: 'ok', proposals: [] }
    answers.department_approvals = [{ bundle: 'B1', who: 'Deepa', job: 'Department Manager', store: 'Lakeside', name: 'Ladies Ethnic', asked_on: '2026-11-11', applied: true,
      sections: [{ id: 'S1', name: 'Sarees', team_leaders: ['Asha'] }] }]
    const page = await render('Approvals')
    expect(page.q('setup-applied')?.textContent).toBe("Already in use: Deepa's report shows these sections. Keep it, or undo it.")
    expect(page.q('setup-card')?.textContent).toContain("Undoing it takes these sections off Deepa's report.")
    expect(page.q('setup-card')?.textContent).not.toContain('Asked on')
    expect(page.q('setup-card')?.textContent).not.toContain('Keeping it opens')
    await page.click('Change, then keep')
    expect(page.q('change-name')).toBeNull()
    await page.click('Cancel')
    await page.click('Undo it')
    expect(page.q('setup-card')?.textContent).toContain("Why undo it? Deepa's report stops showing these sections, and Deepa sees your reason.")
    expect(page.q('setup-card')?.textContent).not.toContain('Undoing it takes these sections off')
    await page.choose(page.q('reject-reason') as HTMLInputElement, 'Wrong store')
    expect(page.q('confirm-reject')?.textContent).toBe('Undo it')
    answers.decide_department = { state: 'Undone' }
    answers.department_approvals = []
    await page.click('Undo it')
    expect(page.q('decision-note')?.textContent).toBe("Undone. Deepa's report no longer shows these sections; Deepa sees your reason.")
    await page.done()
  })
})


// #1205: a department pre-filled from reporting lines, and the Department Manager's answer to it.
describe('a pre-filled department (#1205)', () => {
  const PREFILLED = { ...SETUP, current: { state: 'set_up', name: 'Womenswear', sections: ['Sarees', 'Silk'], reviewing: { bundle: 'B1', waiting_for: 'Mani' },
    prefilled: { bundle: 'B1', sections: [{ id: 'S1', name: 'Sarees' }, { id: 'S2', name: 'Silk' }], flagged: ['Silk'] } } }
  beforeEach(() => window.localStorage.clear())

  it('asks whether it is right, says what is shared, and Yes makes it theirs', async () => {
    answers.department_setup = PREFILLED
    answers.set_up_department = { state: 'set_up' }
    const page = await render('YourDepartment')
    expect(page.q('prefill-banner')?.textContent).toContain('Set up from your team')
    expect(page.q('prefill-banner')?.textContent).toContain('Your report shows Sarees and Silk: the sections your team works in. Is this right?')
    expect(page.q('prefill-flagged')?.textContent).toBe("Silk is shared with another department's team.")
    expect(page.q('prefill-reviewer')?.textContent).toBe('Mani reviews it.')
    answers.department_setup = { ...SETUP, current: { state: 'set_up', name: 'Womenswear', sections: ['Sarees', 'Silk'], reviewing: { bundle: 'B2', waiting_for: 'Mani' } } }
    await page.click("Yes, that's right")
    expect(sentCalls('set_up_department')).toEqual([{ job: 'J1', name: 'Womenswear', sections: ['S1', 'S2'], replaces: 'B1' }])
    expect(page.q('prefill-banner')).toBeNull()
    expect(page.q('note')?.textContent).toBe('Thank you. It is your department now; Mani reviews it.')
    expect(page.q('reviewing')).toBeTruthy()
    await page.done()
  })
  it('Change it opens the form with the pre-fill in it, sent in its place; Cancel goes back', async () => {
    answers.department_setup = PREFILLED
    answers.set_up_department = { state: 'set_up' }
    const page = await render('YourDepartment')
    await page.click('Change it')
    expect(page.q('lead')?.textContent).toContain('What you send replaces the one in use; your report keeps working meanwhile.')
    expect(page.q('lead')?.textContent).not.toContain('opens once it is kept')
    expect((page.q('name-input') as HTMLInputElement).value).toBe('Womenswear')
    expect(rows(page.container).filter(r => r.startsWith('[x]')).map(r => r.slice(4, 10))).toEqual(['Sarees', 'Silk ·'])
    await page.click('Cancel')
    expect(page.q('prefill-banner')).toBeTruthy()
    await page.click('Change it')
    await page.choose(page.q('name-input') as HTMLInputElement, 'Ladies Ethnic')
    await page.click('Send to Mani')
    expect(sentCalls('set_up_department')).toEqual([{ job: 'J1', name: 'Ladies Ethnic', sections: ['S1', 'S2'], replaces: 'B1' }])
    await page.done()
  })
  it('says that two shared sections are shared', async () => {
    answers.department_setup = { ...PREFILLED, current: { ...PREFILLED.current, prefilled: { ...PREFILLED.current.prefilled, flagged: ['Sarees', 'Silk'] } } }
    const page = await render('YourDepartment')
    expect(page.q('prefill-flagged')?.textContent).toBe("Sarees and Silk are shared with another department's team.")
    await page.done()
  })
  it('says why Yes failed', async () => {
    answers.department_setup = PREFILLED
    answers.set_up_department = new Error('That set-up is no longer waiting')
    const page = await render('YourDepartment')
    await page.click("Yes, that's right")
    expect(page.q('prefill-refused')?.textContent).toBe('That set-up is no longer waiting')
    await page.done()
  })
  it('shows as one line instead, remembers it, and goes back', async () => {
    answers.department_setup = { ...PREFILLED, current: { ...PREFILLED.current, prefilled: { ...PREFILLED.current.prefilled, flagged: [] } } }
    const page = await render('YourDepartment')
    expect(page.q('prefill-flagged')).toBeNull()
    await page.click('Show as one line')
    expect(window.localStorage.getItem('dash.prefill-banner')).toBe('line')
    expect(page.q('prefill-line')?.textContent).toContain('Set up from your team: Sarees and Silk. Is this right?')
    await page.click('Show more')
    expect(page.q('prefill-banner')).toBeTruthy()
    await page.done()
  })
  it('reads its style from the address, else the one chosen last, else the full banner', async () => {
    const { prefillStyle } = await import('./department-page')
    expect(prefillStyle('')).toBe('card')
    expect(prefillStyle('?banner=line')).toBe('line')
    window.localStorage.setItem('dash.prefill-banner', 'line')
    expect(prefillStyle('?banner=nonsense')).toBe('line')
    const spy = vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => { throw new Error('private window') })
    expect(prefillStyle('')).toBe('card')
    spy.mockRestore()
  })
})

describe("the reviewer's view of a pre-fill (#1205)", () => {
  it('says it was set up from reporting lines, and marks the shared sections', async () => {
    answers.approvals = { state: 'ok', proposals: [] }
    answers.department_approvals = [{ bundle: 'B1', who: 'Deepa', job: 'Department Manager', store: 'Lakeside', name: 'Womenswear', asked_on: '2026-11-11', applied: true,
      prefilled: true, flagged: ['Silk'], sections: [{ id: 'S1', name: 'Sarees', team_leaders: ['Asha'] }, { id: 'S2', name: 'Silk', team_leaders: [] }] }]
    const page = await render('Approvals')
    expect(page.q('setup-card')?.textContent).toContain('Set up from reporting lines')
    expect(page.q('setup-ask')?.textContent).toBe('“Womenswear” at Lakeside, set up from the reporting lines to Deepa')
    expect(page.q('setup-sections')?.textContent).toBe('Sarees · Team Leader AshaSilk · no Team Leader · shared with another team')
    await page.done()
  })
})

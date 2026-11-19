// The chat panel rendered by React in a DOM, with the platform played by a
// stand-in `fetch` (the network boundary). Made-up figures.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { openDom } from './test-dom'
import { CANCEL_IT, PLACEHOLDERS, SEND_IT, chatWhen, reportOf } from './chat-panel'

// Shop Floor's icons draw nothing here: the panel is read by its words and test ids.
vi.mock('../../../../packages/shop-floor/node_modules/lucide-react', async importOriginal =>
  Object.fromEntries(Object.keys(await importOriginal<object>()).map(name => [name, () => null])))

let closeDom: () => void = () => {}
const realFetch = globalThis.fetch
const calls: { url: string; payload: Record<string, unknown>; answer: (status: number, body: unknown) => void }[] = []
beforeAll(() => {
  closeDom = openDom()
  ;(globalThis as Record<string, unknown>).fetch = (url: string, init: RequestInit) => new Promise(resolveCall => {
    calls.push({ url: String(url), payload: JSON.parse(String(init.body)).payload,
      answer: (status, body) => resolveCall(new Response(JSON.stringify(body), { status })) })
  })
})
afterAll(() => {
  ;(globalThis as Record<string, unknown>).fetch = realFetch
  closeDom()
})

const CHAT = '/api/app_chat/dash'
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const find = (testid: string) => document.querySelector(`[data-testid="${testid}"]`)
const all = (testid: string) => [...document.querySelectorAll(`[data-testid="${testid}"]`)]
/** A mode's button in the shared Segmented control, by its label. */
const modeButton = (label: string) => [...document.querySelectorAll('[aria-label="Mode"] button')].find(button => button.textContent === label)
const result = {
  model: 'sales_vs_target', truncated: false, served: 'cached', at: '2026-11-15T00:19:00.000Z', asOf: '2026-11-14', places: ['9901'],
  columns: [{ name: 'store', kind: 'dimension' }, { name: 'sales', kind: 'measure' }], rows: [['Lakeside', 1962013.01]],
}
const EVERY = [{ mode: 'agent', label: 'Agent' }, { mode: 'reports', label: 'Reports' }, { mode: 'ask', label: 'Ask' }, { mode: 'action', label: 'Action' }]
const message = (id: number, role: string, mode: string, content: Record<string, unknown>) => ({ id, role, mode, content, at: '2026-11-17T04:00:00.000Z' })
const session = { id: 7, title: 'Sales by store?', updated_at: '2026-11-17T04:00:00.000Z' }

let unmount: () => void = () => {}
const reports: unknown[] = []
async function open(modes: unknown = EVERY, more: Record<string, unknown> = {}) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ChatPanel } = await import('./chat-panel')
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  await act(async () => { root.render(<ChatPanel onReport={report => reports.push(report)} />) })
  // The panel first asks the platform which modes this person holds.
  const first = calls.shift()!
  expect(first.url).toBe(`${CHAT}/modes`)
  await act(async () => { first.answer(modes === 'refused' ? 500 : 200, { title: 'FeatherBot', modes, ...more }); await settle() })
  unmount = () => { act(() => root.unmount()); container.remove() }
  // The panel opens from its button on the report's header line; someone with no mode and nothing to review has no button.
  if (find('chat-open')) await act(async () => { (find('chat-open') as HTMLElement).click(); await settle() })
  const type = (text: string) => act(async () => {
    const input = find('chat-input') as HTMLTextAreaElement
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, text)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  const press = (element: Element) => act(async () => { (element as HTMLElement).click(); await settle() })
  const answer = (status: number, body: unknown) => act(async () => { calls.at(-1)!.answer(status, body); await settle() })
  const say = async (text: string) => { await type(text); await press(find('chat-send')!) }
  return { act, container, type, press, answer, say }
}
afterEach(() => { unmount(); calls.length = 0; reports.length = 0 })

describe('the chat panel', () => {
  it('shows the modes the person holds, the first one chosen, and nothing at all to a person with none', async () => {
    await open([{ mode: 'ask', label: 'Ask' }, { mode: 'action', label: 'Action' }])
    expect(find('chat-panel')!.getAttribute('aria-label')).toBe('FeatherBot')
    expect(modeButton('Agent')).toBeUndefined()
    expect(modeButton('Ask')!.getAttribute('aria-pressed')).toBe('true')
    expect((find('chat-input') as HTMLTextAreaElement).placeholder).toBe(PLACEHOLDERS.ask)
    // Questions to start from are about figures: none in Ask.
    expect(all('chat-suggestion')).toEqual([])
    unmount()
    await open([])
    expect([find('chat-open'), find('chat-panel')]).toEqual([null, null])
    unmount()
    await open('refused')
    expect([find('chat-open'), find('chat-panel')]).toEqual([null, null])
  })

  it('Agent answers in the chat: what was said, then the words and the table, with its SQL', async () => {
    const page = await open()
    expect(all('chat-suggestion').length).toBeGreaterThan(0)
    await page.say('  Sales by store?  ')
    expect(calls[0]).toMatchObject({ url: `${CHAT}/send`, payload: { mode: 'agent', text: 'Sales by store?' } })
    expect(find('chat-pending')!.textContent).toBe('Sales by store?')
    expect((find('chat-send') as HTMLButtonElement).disabled).toBe(true)
    await page.answer(200, { session, messages: [message(1, 'user', 'agent', { text: 'Sales by store?' }),
      message(2, 'assistant', 'agent', { kind: 'figures', question: 'Sales by store?', model: 'sales_vs_target', sql: 'select store from sales_vs_target', text: 'Lakeside sold ₹19,62,013.', result })] })
    expect(find('chat-pending')).toBeNull()
    expect(all('chat-said').map(said => said.textContent)).toEqual(['Sales by store?'])
    const reply = find('chat-reply')!
    expect(reply.getAttribute('data-kind')).toBe('figures')
    expect(reply.querySelector('.fd-chat-text')!.textContent).toBe('Lakeside sold ₹19,62,013.')
    expect([...reply.querySelectorAll('tbody tr > *')].map(cell => cell.textContent)).toEqual(['Lakeside', '₹19,62,013.01'])
    expect(find('ask-sql')!.textContent).toBe('select store from sales_vs_target')
    expect(find('chat-panel')!.querySelector('h2')!.textContent).toBe('Sales by store?')
    expect(reports).toEqual([])
    // The next thing said goes to the same conversation.
    await page.say('And in pieces?')
    expect(calls[1].payload).toEqual({ mode: 'agent', text: 'And in pieces?', session: 7 })
  })

  it('Reports draws its answer on the page and says so in the chat; it can be shown again', async () => {
    const page = await open()
    await page.press(modeButton('Reports')!)
    await page.press(all('chat-suggestion')[0])
    expect(calls[0].payload).toMatchObject({ mode: 'reports' })
    const report = { kind: 'report', question: 'How is my store doing?', model: 'sales_vs_target', plan: { measures: ['sales'] }, result }
    await page.answer(200, { session, messages: [message(1, 'user', 'reports', { text: 'How is my store doing?' }), message(2, 'assistant', 'reports', report)] })
    expect(reports).toEqual([report])
    expect(find('chat-reply')!.textContent).toContain('The report is on the page: “How is my store doing?”.')
    expect(find('chat-reply')!.querySelector('table')).toBeNull()
    await page.press(find('chat-show-report')!)
    expect(reports).toEqual([report, report])
  })

  it('Ask shows the answer with its sources; a refusal and a question back are said plainly', async () => {
    const page = await open()
    await page.press(modeButton('Ask')!)
    await page.say('How is achievement worked out?')
    await page.answer(200, { session, messages: [message(1, 'user', 'ask', { text: 'How is achievement worked out?' }),
      message(2, 'assistant', 'ask', { kind: 'help', text: 'Sales as a percentage of target.', sources: [{ source: 'help/dash/what-the-figures-mean.md', heading: 'What the figures mean › Achievement' }] }),
      message(3, 'assistant', 'action', { kind: 'refused', text: 'Actions are not available yet.' }),
      message(4, 'assistant', 'agent', { kind: 'clarify', question: 'How much?', text: 'Rupees or pieces?' })] })
    const replies = all('chat-reply')
    expect(replies.map(reply => reply.getAttribute('data-kind'))).toEqual(['help', 'refused', 'clarify'])
    expect(replies[0].querySelector('.fd-chat-text')!.textContent).toBe('Sales as a percentage of target.')
    expect(find('chat-sources')!.textContent).toBe('help/dash/what-the-figures-mean.md · What the figures mean › Achievement')
    expect(replies[1].querySelector('[role="status"]')!.textContent).toBe('Actions are not available yet.')
    expect(replies[2].textContent).toBe('Rupees or pieces?')
  })

  it('Enter sends and Shift+Enter does not; a failure is said and what was typed comes back', async () => {
    const page = await open()
    await page.type('Sales?')
    const key = (shiftKey: boolean) => page.act(async () => {
      find('chat-input')!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true }))
      await settle()
    })
    await key(true)
    expect(calls).toEqual([])
    await key(false)
    expect(calls).toHaveLength(1)
    // While one is being answered, another is not sent.
    await key(false)
    expect(calls).toHaveLength(1)
    await page.answer(403, { error: { message: 'You do not have the Agent mode of this chat' } })
    expect(find('chat-failure')!.textContent).toBe("You don't have access to ask about any store yet.")
    expect((find('chat-input') as HTMLTextAreaElement).value).toBe('Sales?')
    expect(all('chat-said')).toEqual([])
  })

  it('the conversations are listed, opened, removed, and a new one started', async () => {
    const page = await open()
    await page.press(find('chat-sessions')!)
    expect(calls[0].url).toBe(`${CHAT}/sessions`)
    await page.answer(200, { sessions: [session, { id: 8, title: 'How do returns work?', updated_at: '2026-11-10T04:00:00.000Z' }] })
    expect(all('chat-session').map(item => item.querySelector('.fd-chat-session-title')!.textContent)).toEqual(['Sales by store?', 'How do returns work?'])
    expect(find('chat-panel')!.querySelector('h2')!.textContent).toBe('Sessions')
    await page.press(all('chat-session')[0])
    expect(calls[1].url).toBe(`${CHAT}/sessions/7`)
    await page.answer(200, { session, messages: [message(1, 'user', 'agent', { text: 'Sales by store?' }), message(2, 'assistant', 'agent', { kind: 'refused', text: 'Not today.' })] })
    expect(find('chat-session-list')).toBeNull()
    expect(all('chat-said').map(said => said.textContent)).toEqual(['Sales by store?'])
    // Removing the conversation on show from the list empties the panel.
    await page.press(find('chat-sessions')!)
    await page.answer(200, { sessions: [session] })
    await page.press(find('chat-session-close')!)
    expect(calls[3].url).toBe(`${CHAT}/sessions/7/close`)
    await page.answer(200, { sessions: [] })
    expect(find('chat-session-list')!.textContent).toContain('No Conversations Yet')
    await page.press(find('chat-back')!)
    expect(find('chat-empty')).not.toBeNull()
    await page.say('Fresh start')
    expect(calls[4].payload).toEqual({ mode: 'agent', text: 'Fresh start' })
    await page.answer(200, { session: { ...session, id: 9, title: 'Fresh start' }, messages: [message(5, 'user', 'agent', { text: 'Fresh start' }), message(6, 'assistant', 'agent', { kind: 'refused', text: 'No.' })] })
    await page.press(find('chat-new')!)
    expect(find('chat-empty')).not.toBeNull()
    expect(find('chat-panel')!.querySelector('h2')!.textContent).toBe('FeatherBot')
  })

  it('a list or a conversation that cannot be read is said', async () => {
    const page = await open()
    await page.press(find('chat-sessions')!)
    await page.answer(500, {})
    expect(find('chat-failure')!.textContent).toBe("That question couldn't be answered. Try again.")
    await page.press(find('chat-sessions')!)
    await page.answer(200, { sessions: [session] })
    expect(find('chat-failure')).toBeNull()
    await page.press(find('chat-session')!)
    await page.answer(404, {})
    expect(find('chat-failure')).not.toBeNull()
    await page.press(find('chat-session-close')!)
    await page.answer(500, {})
    expect(find('chat-session-list')).not.toBeNull()
  })
})

describe('requests in the chat panel', () => {
  const offered = [{ name: 'target_review', title: 'Target review', description: 'Ask for a target to be looked at again.' }]
  const inputs = [{ name: 'store', label: 'Store', value: 'Lakeside' }, { name: 'reason', label: 'Reason', value: 'Stock came late' }]
  const confirm = { kind: 'confirm', question: 'Review the target', request: 'target_review', title: 'Target review', inputs, text: 'Nothing has been sent yet. Shall I send this for a person to review?' }
  const waiting = { id: 12, ticket: 'TR-12', title: 'Target review', inputs, status: 'pending_review', at: '2026-11-17T04:00:00.000Z' }

  it('Action says what can be sent, shows what it would send, and sends it only when the person says so', async () => {
    const page = await open(EVERY, { requests: offered })
    await page.press(modeButton('Action')!)
    expect(all('chat-offered').map(item => item.textContent)).toEqual(['Target review. Ask for a target to be looked at again.'])
    expect(all('chat-suggestion')).toEqual([])
    await page.say('Review the target')
    await page.answer(200, { session, messages: [message(1, 'user', 'action', { text: 'Review the target' }), message(2, 'assistant', 'action', confirm)] })
    const reply = find('chat-reply')!
    expect(reply.getAttribute('data-kind')).toBe('confirm')
    expect([...reply.querySelectorAll('dt, dd')].map(cell => cell.textContent)).toEqual(['Store', 'Lakeside', 'Reason', 'Stock came late'])
    expect(reply.querySelector('.fd-chat-text')!.textContent).toBe(confirm.text)
    // The buttons answer in the Action mode whatever mode is chosen by then.
    await page.press(modeButton('Ask')!)
    await page.press(find('chat-confirm')!)
    expect(calls[1].payload).toEqual({ mode: 'action', text: SEND_IT, session: 7 })
    expect(find('chat-confirm')).toBeNull()
    await page.answer(200, { session, messages: [message(3, 'user', 'action', { text: SEND_IT }),
      message(4, 'assistant', 'action', { kind: 'submitted', question: SEND_IT, ticket: 'TR-12', text: 'Request TR-12 has been sent.' })] })
    expect(all('chat-reply').at(-1)!.textContent).toBe('Request TR-12 has been sent.')
    // Only the latest thing shown can be answered: the request already sent has no buttons.
    expect(find('chat-confirm')).toBeNull()
    await page.say('Another')
    await page.answer(200, { session, messages: [message(5, 'user', 'action', { text: 'Another' }), message(6, 'assistant', 'action', confirm)] })
    await page.press(find('chat-cancel')!)
    expect(calls[3].payload).toEqual({ mode: 'action', text: CANCEL_IT, session: 7 })
    await page.answer(200, { session, messages: [message(7, 'user', 'action', { text: CANCEL_IT }),
      message(8, 'assistant', 'action', { kind: 'requests', question: 'Mine?', text: 'Your requests, the latest first:', requests: [{ ...waiting, status: 'rejected', decided_at: '2026-11-17T05:00:00.000Z', note: 'Not this month' }] })] })
    const sent = find('chat-sent-item')!
    expect(sent.querySelector('[data-testid="chat-request-state"]')!.textContent).toBe('Rejected')
    expect(sent.querySelector('[data-testid="chat-request-note"]')!.textContent).toBe('Reviewer’s note: Not this month')
  })

  it('the Requests list shows what the person sent, and a reviewer approves or rejects what is waiting', async () => {
    const page = await open(EVERY, { review: true, requests: offered })
    await page.press(find('chat-requests')!)
    expect(calls[0].url).toBe(`${CHAT}/requests`)
    await page.answer(200, { mine: [], review: [{ ...waiting, requester: 'Selvi Store-Manager', requester_who: { code: 'E1001', jobs: ['Store Manager · Lakeside'], staff: 'current' } }] })
    expect(find('chat-panel')!.querySelector('h2')!.textContent).toBe('Requests')
    expect(find('chat-mine')!.textContent).toContain('You have not sent any requests.')
    const item = find('chat-review-item')!
    expect(item.textContent).toContain('TR-12 Target review')
    // The sender is named as every Dash screen names a person: the name, then code · job · place.
    expect(item.querySelector('[data-testid="chat-requester"]')!.textContent).toContain('Selvi Store-Manager')
    expect(item.querySelector('[data-testid="person-detail"]')!.textContent).toBe('E1001 · Store Manager · Lakeside')
    expect(item.querySelector('[data-testid="chat-request-state"]')!.textContent).toBe('Waiting For Review')
    await page.act(async () => {
      const note = find('chat-review-note') as HTMLInputElement
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(note), 'value')!.set!.call(note, '  Agreed  ')
      note.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    await page.press(find('chat-approve')!)
    expect(calls[1]).toMatchObject({ url: `${CHAT}/requests/12/decide`, payload: { decision: 'approved', note: 'Agreed' } })
    await page.answer(200, { mine: [{ ...waiting, id: 9, ticket: 'TR-9', status: 'approved', decided_at: '2026-11-17T05:00:00.000Z', note: '' }],
      review: [{ ...waiting, id: 13, ticket: 'TR-13' }] })
    expect(find('chat-mine-item')!.textContent).toContain('Approved')
    expect(find('chat-mine-item')!.querySelector('[data-testid="chat-request-note"]')).toBeNull()
    await page.press(find('chat-reject')!)
    expect(calls[2]).toMatchObject({ url: `${CHAT}/requests/13/decide` })
    expect(calls[2].payload).toEqual({ decision: 'rejected' })
    await page.answer(409, { error: { message: 'That request has already been decided' } })
    expect(find('chat-failure')).not.toBeNull()
    await page.press(find('chat-back')!)
    expect(find('chat-request-list')).toBeNull()
    expect(find('chat-empty')).not.toBeNull()
    // A person who does not review sees only their own.
    await page.press(find('chat-requests')!)
    await page.answer(200, { mine: [] })
    expect(find('chat-review')).toBeNull()
    // The list of conversations and the requests take each other's place.
    await page.press(find('chat-back')!)
    await page.press(find('chat-sessions')!)
    await page.answer(200, { sessions: [] })
    expect(find('chat-session-list')).not.toBeNull()
    await page.press(find('chat-requests')!)
    expect(find('chat-session-list')).toBeNull()
    await page.answer(500, {})
    expect(find('chat-failure')).not.toBeNull()
  })

  it('a person who only reviews is shown what is waiting, with nothing to type into', async () => {
    await open([], { review: true })
    expect(calls[0].url).toBe(`${CHAT}/requests`)
    const { act } = await import('react')
    await act(async () => { calls[0].answer(200, { mine: [], review: [] }); await settle() })
    expect(find('chat-review')!.textContent).toContain('Nothing is waiting.')
    expect(find('chat-input')).toBeNull()
    expect(find('chat-new')).toBeNull()
    expect(find('chat-back')).toBeNull()
  })
})

describe('the panel\'s small rules', () => {
  it('a reply carries a report only when it is one with figures', () => {
    expect(reportOf({ kind: 'report', question: 'Q', result })).toMatchObject({ question: 'Q' })
    expect(reportOf({ kind: 'report', question: 'Q', result: null })).toBeUndefined()
    expect(reportOf({ kind: 'figures', result })).toBeUndefined()
  })

  it('a time is written as every Dash screen writes one', () => {
    expect(chatWhen('2026-11-17T09:05:00')).toMatch(/^17-Nov-2026 /)
  })
})

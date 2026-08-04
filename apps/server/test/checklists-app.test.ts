// The checklists sample app (sample-apps/checklists.ts): a reusable
// Checklist Template instantiated as Checklist Runs. The contract under
// test — a run SNAPSHOTS its template's items at creation (later template
// edits never rewrite it), ticks stamp/clear done_at and derive progress,
// and moving to Submitted is gated on must-do items (a note is an accepted
// excuse). Registered at boot like helpdesk; installed per test and rolled
// back by the sandbox.

import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { installApp, uninstallApp, isInstalled } from '../src/apps'
import { sql } from '../src/db'

const TEMPLATE_DT = 'Checklist Template'
const RUN_DT = 'Checklist Run'

const FIXTURE_LABELS = [
  'Aisle floor cleaned, no cartons in walkway',
  'All fixtures faced up and size-sequenced',
  'New arrivals on the entry table with price tags',
  "Mannequins re-dressed per this week's VM note",
  'Fast movers from yesterday photographed for buyer',
  'Damaged/soiled pieces pulled to the holding rack',
  'Price-tag gun and spare tags at the counter',
  'Trial-room hooks and mirrors checked',
]

type Row = Record<string, any>

// A dev database may carry committed checklists structure (the checklist
// e2e installs it over HTTP); these round trips need a clean slate, which
// CI and throwaway DBs always are — the same guard the helpdesk round-trip
// test uses.
async function dirty(): Promise<boolean> {
  const [row] = await sql`select 1 from table_def where name = ${RUN_DT}`
  return Boolean(row)
}

async function install() {
  const res = await installApp('checklists')
  const template = res.fixtures.find((f) => f.table === TEMPLATE_DT)
  if (!template) throw new Error('install created no template fixture')
  return { ...res, templateName: template.name }
}

const unwire = () => uninstallApp('checklists').catch(() => {})

describe('checklists app: template → run lifecycle', () => {
  test('install ships a usable template; uninstall removes everything', async ({ admin, skip }) => {
    if (await dirty()) skip('dev database already carries the checklists structure')
    const { templateName } = await install()
    try {
      const template = await admin.get<Row>(`/api/table/${encodeURIComponent(TEMPLATE_DT)}/${templateName}`)
      expect(template.template_name).toBe('Section Opening — Ground Floor')
      expect((template.items as Row[]).map((i) => i.item_label)).toEqual(FIXTURE_LABELS)
      expect((template.items as Row[]).map((i) => Boolean(i.must_do))).toEqual([
        true, true, true, false, false, true, false, true,
      ])
      expect((template.items as Row[]).map((i) => Boolean(i.photo_proof))).toEqual([
        false, false, true, true, true, false, false, false,
      ])
    } finally {
      await unwire()
    }
    expect(await isInstalled('checklists')).toBe(false)
    const gone = await sql`select 1 from table_def where name in (${TEMPLATE_DT}, ${RUN_DT})`
    expect(gone).toHaveLength(0)
  })

  test("a new run snapshots the template's items; editing the template later does not rewrite it", async ({
    admin,
    skip,
  }) => {
    if (await dirty()) skip('dev database already carries the checklists structure')
    const { templateName } = await install()
    try {
      const run = await admin.post<Row>('/api/save_doc', {
        doctype: RUN_DT,
        doc: { template: templateName, store: 'ATK', section: 'Kurti', team_leader: 'Priya S' },
      })
      const items = run.items as Row[]
      expect(items.map((i) => i.item_label)).toEqual(FIXTURE_LABELS)
      expect(items.every((i) => !i.done)).toBe(true)
      expect(items.map((i) => Boolean(i.must_do))).toEqual([
        true, true, true, false, false, true, false, true,
      ])
      expect(run.progress).toBe('0/8')
      expect(run.run_status).toBe('Open')
      expect(run.run_title).toBe('Section Opening — Ground Floor — Kurti')
      expect(String(run.run_date).slice(0, 10)).toBe(new Date().toISOString().slice(0, 10))

      // Option A's core promise: the run keeps its snapshot.
      const template = await admin.get<Row>(`/api/table/${encodeURIComponent(TEMPLATE_DT)}/${templateName}`)
      const edited = (template.items as Row[]).map((i, idx) =>
        idx === 0 ? { ...i, item_label: 'CHANGED after the run started' } : i,
      )
      await admin.post('/api/save_doc', {
        doctype: TEMPLATE_DT,
        doc: { name: templateName, updated_at: template.updated_at, items: edited },
      })
      const runAfter = await admin.get<Row>(`/api/table/${encodeURIComponent(RUN_DT)}/${run.name}`)
      expect((runAfter.items as Row[])[0].item_label).toBe(FIXTURE_LABELS[0])
    } finally {
      await unwire()
    }
  })

  test('ticking stamps done_at, unticking clears it, progress follows', async ({ admin, skip }) => {
    if (await dirty()) skip('dev database already carries the checklists structure')
    const { templateName } = await install()
    try {
      const run = await admin.post<Row>('/api/save_doc', {
        doctype: RUN_DT,
        doc: { template: templateName, section: 'Kurti' },
      })
      const tick = (items: Row[], idx: number, done: boolean) =>
        items.map((i, n) => (n === idx ? { ...i, done } : i))

      const ticked = await admin.post<Row>('/api/save_doc', {
        doctype: RUN_DT,
        doc: { name: run.name, updated_at: run.updated_at, items: tick(run.items as Row[], 0, true) },
      })
      expect(ticked.progress).toBe('1/8')
      expect((ticked.items as Row[])[0].done).toBe(true)
      expect((ticked.items as Row[])[0].done_at).toBeTruthy()
      expect((ticked.items as Row[])[1].done_at).toBeFalsy()

      const unticked = await admin.post<Row>('/api/save_doc', {
        doctype: RUN_DT,
        doc: {
          name: run.name,
          updated_at: ticked.updated_at,
          items: tick(ticked.items as Row[], 0, false),
        },
      })
      expect(unticked.progress).toBe('0/8')
      expect((unticked.items as Row[])[0].done_at).toBeFalsy()
    } finally {
      await unwire()
    }
  })

  test('submit is gated on must-do items — a note is an accepted excuse', async ({ admin, skip }) => {
    if (await dirty()) skip('dev database already carries the checklists structure')
    const { templateName } = await install()
    try {
      const run = await admin.post<Row>('/api/save_doc', {
        doctype: RUN_DT,
        doc: { template: templateName, section: 'Kurti' },
      })

      // Status-only update, no items in the payload: the gate must read the
      // current child rows from the database — and block.
      await expect(
        admin.post('/api/save_doc', {
          doctype: RUN_DT,
          doc: { name: run.name, updated_at: run.updated_at, run_status: 'Submitted' },
        }),
      ).rejects.toMatchObject({
        status: 417,
        message: expect.stringMatching(/must-do/),
      })

      // Tick every must-do item except one; give that one a note instead.
      const items = (run.items as Row[]).map((i, idx) =>
        idx === 5 ? { ...i, note: 'holding rack full — housekeeping informed' } : Boolean(i.must_do) ? { ...i, done: true } : i,
      )
      const submitted = await admin.post<Row>('/api/save_doc', {
        doctype: RUN_DT,
        doc: { name: run.name, updated_at: run.updated_at, run_status: 'Submitted', items },
      })
      expect(submitted.run_status).toBe('Submitted')
      expect(submitted.progress).toBe('4/8')
    } finally {
      await unwire()
    }
  })

  test('a team leader works own runs only; a store manager sees all', async ({
    admin,
    createUser,
    skip,
  }) => {
    if (await dirty()) skip('dev database already carries the checklists structure')
    const { templateName } = await install()
    try {
      const tl = await createUser({ roles: ['Team Leader'] })
      const sm = await createUser({ roles: ['Store Manager'] })

      const ins = await tl.fetch(`/api/table/${encodeURIComponent(RUN_DT)}`, {
        method: 'POST',
        body: JSON.stringify({ template: templateName, section: 'Kurti', team_leader: 'TL' }),
      })
      expect(ins.status).toBe(201)
      const tlRun = (await ins.json()) as Row

      const adminRun = await admin.post<Row>('/api/save_doc', {
        doctype: RUN_DT,
        doc: { template: templateName, section: 'Women Ethnic Sets' },
      })

      // TL: own run readable, the admin's run invisible, template read-only.
      expect((await tl.fetch(`/api/table/${encodeURIComponent(RUN_DT)}/${tlRun.name}`)).status).toBe(200)
      expect((await tl.fetch(`/api/table/${encodeURIComponent(RUN_DT)}/${adminRun.name}`)).status).toBe(403)
      const tlList = (await (await tl.fetch(`/api/table/${encodeURIComponent(RUN_DT)}`)).json()) as {
        data: Row[]
      }
      expect(tlList.data.map((r) => r.name)).toEqual([tlRun.name])
      expect(
        (
          await tl.fetch(`/api/table/${encodeURIComponent(TEMPLATE_DT)}/${templateName}`, {
            method: 'DELETE',
          })
        ).status,
      ).toBe(403)

      // SM sees both runs.
      const smList = (await (await sm.fetch(`/api/table/${encodeURIComponent(RUN_DT)}`)).json()) as {
        data: Row[]
      }
      expect(smList.data.map((r) => r.name).sort()).toEqual([tlRun.name, adminRun.name].sort())
    } finally {
      await unwire()
    }
  })
})

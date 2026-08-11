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
import { tableName } from '../src/doctype-engine'
import { deleteStored } from '../src/storage'
import type { TestClient } from 'feather-testing-postgres'

const TEMPLATE_DT = 'Checklist Template'
const RUN_DT = 'Checklist Run'
const ITEM_DT = 'Checklist Run Item'

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

// Table deletion (docs/specs/0003-table-deletion.md) paying its hermeticity
// dividend, the same conversion the import create-path specs got: a dev
// database may carry committed checklists structure (the checklist e2e
// installs it over HTTP), so PRE-CLEAN it rather than skipping. The removal
// happens inside the test's own transaction, so the rollback hands the
// database back exactly as it was.
//
// These tests used to skip on a used database, and a skipped suite reports
// green while proving nothing — a full run once showed "605 passed" with all
// eight of these silently skipped. A failure to pre-clean now fails the test
// loudly instead.
async function install() {
  if (await isInstalled('checklists')) await uninstallApp('checklists')
  const res = await installApp('checklists')
  const template = res.fixtures.find((f) => f.table === TEMPLATE_DT)
  if (!template) throw new Error('install created no template fixture')
  return { ...res, templateName: template.row_id }
}

const unwire = () => uninstallApp('checklists').catch(() => {})

const itemNames = async (run: string): Promise<string[]> =>
  (
    await sql`
      select row_id from ${sql(tableName(ITEM_DT))}
      where parent = ${run} and parenttype = ${RUN_DT} order by position`
  ).map((r) => r.row_id as string)

// Attach a file to a row the way the checklist view does — private, bound to
// the CHILD item row.
async function attach(as: TestClient, itemName: string) {
  const form = new FormData()
  form.append('file', new File(['photo-bytes'], 'rack.jpg', { type: 'image/jpeg' }))
  form.append('ref_doctype', ITEM_DT)
  form.append('ref_name', itemName)
  form.append('is_private', '1')
  return as.fetch('/api/upload_file', { method: 'POST', body: form })
}

describe('checklists app: template → run lifecycle', () => {
  test('install ships a usable template; uninstall removes everything', async ({ admin }) => {
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
  }) => {
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
        doc: { row_id: templateName, updated_at: template.updated_at, items: edited },
      })
      const runAfter = await admin.get<Row>(`/api/table/${encodeURIComponent(RUN_DT)}/${run.row_id}`)
      expect((runAfter.items as Row[])[0].item_label).toBe(FIXTURE_LABELS[0])
    } finally {
      await unwire()
    }
  })

  test('ticking stamps done_at, unticking clears it, progress follows', async ({ admin }) => {
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
        doc: { row_id: run.row_id, updated_at: run.updated_at, items: tick(run.items as Row[], 0, true) },
      })
      expect(ticked.progress).toBe('1/8')
      expect((ticked.items as Row[])[0].done).toBe(true)
      expect((ticked.items as Row[])[0].done_at).toBeTruthy()
      expect((ticked.items as Row[])[1].done_at).toBeFalsy()

      const unticked = await admin.post<Row>('/api/save_doc', {
        doctype: RUN_DT,
        doc: {
          row_id: run.row_id,
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

  test('submit is gated on must-do items — a note is an accepted excuse', async ({ admin }) => {
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
          doc: { row_id: run.row_id, updated_at: run.updated_at, run_status: 'Submitted' },
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
        doc: { row_id: run.row_id, updated_at: run.updated_at, run_status: 'Submitted', items },
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
  }) => {
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
      expect((await tl.fetch(`/api/table/${encodeURIComponent(RUN_DT)}/${tlRun.row_id}`)).status).toBe(200)
      expect((await tl.fetch(`/api/table/${encodeURIComponent(RUN_DT)}/${adminRun.row_id}`)).status).toBe(403)
      const tlList = (await (await tl.fetch(`/api/table/${encodeURIComponent(RUN_DT)}`)).json()) as {
        data: Row[]
      }
      expect(tlList.data.map((r) => r.row_id)).toEqual([tlRun.row_id])
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
      expect(smList.data.map((r) => r.row_id).sort()).toEqual([tlRun.row_id, adminRun.row_id].sort())
    } finally {
      await unwire()
    }
  })

  // The snapshot is what makes a run auditable: it must be the SERVER's
  // record of the standard, not a shape the caller can redraw on the way to
  // a clean submit.
  test('a payload may tick items and excuse them — it may never reshape the snapshot', async ({
    admin,
  }) => {
    const { templateName } = await install()
    try {
      // Creation ignores caller-supplied items entirely: structure comes from
      // the template or not at all.
      const run = await admin.post<Row>('/api/save_doc', {
        doctype: RUN_DT,
        doc: {
          template: templateName,
          section: 'Kurti',
          items: [{ item_label: 'one easy thing I made up', must_do: false, done: true }],
        },
      })
      expect((run.items as Row[]).map((i) => i.item_label)).toEqual(FIXTURE_LABELS)
      expect(run.progress).toBe('0/8')

      // An empty array cannot delete the snapshot, and so cannot buy a clean
      // submit: the gate judges the persisted items.
      await expect(
        admin.post('/api/save_doc', {
          doctype: RUN_DT,
          doc: { row_id: run.row_id, updated_at: run.updated_at, run_status: 'Submitted', items: [] },
        }),
      ).rejects.toMatchObject({ status: 417, message: expect.stringMatching(/must-do/) })
      const intact = await admin.get<Row>(`/api/table/${encodeURIComponent(RUN_DT)}/${run.row_id}`)
      expect(intact.items as Row[]).toHaveLength(8)
      expect(intact.run_status).toBe('Open')

      // Labels and the must_do / photo_proof policy are snapshot structure;
      // done_at is a server stamp; an invented row is not an item. All four
      // are folded back onto what is stored.
      const forged = [
        ...(intact.items as Row[]).map((i) => ({
          ...i,
          item_label: 'rewritten by the client',
          must_do: false,
          photo_proof: true,
          done_at: '2001-01-01T00:00:00.000Z',
        })),
        { item_label: 'smuggled in', must_do: false, done: true },
      ]
      const saved = await admin.post<Row>('/api/save_doc', {
        doctype: RUN_DT,
        doc: { row_id: run.row_id, updated_at: intact.updated_at, items: forged },
      })
      const items = saved.items as Row[]
      expect(items).toHaveLength(8)
      expect(items.map((i) => i.item_label)).toEqual(FIXTURE_LABELS)
      expect(items.map((i) => Boolean(i.must_do))).toEqual([
        true, true, true, false, false, true, false, true,
      ])
      expect(items.map((i) => Boolean(i.photo_proof))).toEqual([
        false, false, true, true, true, false, false, false,
      ])
      // Nothing was ticked, so nothing carries a stamp — least of all the
      // backdated one that was sent.
      expect(items.every((i) => !i.done_at)).toBe(true)
      expect(saved.progress).toBe('0/8')
    } finally {
      await unwire()
    }
  })

  test('a submitted run is final: no late ticks, and no way back to Open', async ({
    admin,
  }) => {
    const { templateName } = await install()
    try {
      const run = await admin.post<Row>('/api/save_doc', {
        doctype: RUN_DT,
        doc: { template: templateName, section: 'Kurti' },
      })
      const submitted = await admin.post<Row>('/api/save_doc', {
        doctype: RUN_DT,
        doc: {
          row_id: run.row_id,
          updated_at: run.updated_at,
          run_status: 'Submitted',
          items: (run.items as Row[]).map((i) => (i.must_do ? { ...i, done: true } : i)),
        },
      })
      expect(submitted.run_status).toBe('Submitted')
      expect(submitted.progress).toBe('5/8')

      const refused = /submitted/i
      // A late tick.
      await expect(
        admin.post('/api/save_doc', {
          doctype: RUN_DT,
          doc: {
            row_id: run.row_id,
            updated_at: submitted.updated_at,
            items: (submitted.items as Row[]).map((i, n) => (n === 6 ? { ...i, done: true } : i)),
          },
        }),
      ).rejects.toMatchObject({ status: 417, message: expect.stringMatching(refused) })
      // A late excuse note.
      await expect(
        admin.post('/api/save_doc', {
          doctype: RUN_DT,
          doc: {
            row_id: run.row_id,
            updated_at: submitted.updated_at,
            items: (submitted.items as Row[]).map((i, n) =>
              n === 0 ? { ...i, note: 'thought better of it' } : i,
            ),
          },
        }),
      ).rejects.toMatchObject({ status: 417, message: expect.stringMatching(refused) })
      // Reopening it.
      await expect(
        admin.post('/api/save_doc', {
          doctype: RUN_DT,
          doc: { row_id: run.row_id, updated_at: submitted.updated_at, run_status: 'Open' },
        }),
      ).rejects.toMatchObject({ status: 417, message: expect.stringMatching(refused) })

      const after = await admin.get<Row>(`/api/table/${encodeURIComponent(RUN_DT)}/${run.row_id}`)
      expect(after.run_status).toBe('Submitted')
      expect(after.progress).toBe('5/8')
      expect((after.items as Row[])[6].done).toBe(false)
      expect((after.items as Row[])[0].note).toBeFalsy()
    } finally {
      await unwire()
    }
  })

  // own_rows_only on the parent is only worth as much as the paths AROUND it:
  // the child rows, the photos hanging off them, and the upload that binds a
  // file to one.
  test("a team leader cannot reach another leader's items, photos or uploads", async ({
    createUser,
  }) => {
    const { templateName } = await install()
    const uploaded: string[] = []
    try {
      const tl1 = await createUser({ roles: ['Team Leader'] })
      const tl2 = await createUser({ roles: ['Team Leader'] })
      const startRun = async (as: TestClient, section: string) => {
        const res = await as.fetch(`/api/table/${encodeURIComponent(RUN_DT)}`, {
          method: 'POST',
          body: JSON.stringify({ template: templateName, section }),
        })
        expect(res.status).toBe(201)
        return (await res.json()) as Row
      }
      const run1 = await startRun(tl1, 'Kurti')
      const run2 = await startRun(tl2, 'Denim')
      const [item1] = await itemNames(String(run1.row_id))
      const own = await itemNames(String(run2.row_id))

      // 1. A child row is only as readable as the run it hangs on — one by
      // name, and the whole list.
      expect((await tl2.fetch(`/api/table/${encodeURIComponent(ITEM_DT)}/${item1}`)).status).toBe(403)
      const childList = (await (
        await tl2.fetch(`/api/table/${encodeURIComponent(ITEM_DT)}?limit_page_length=200`)
      ).json()) as { data: Row[] }
      expect(childList.data.map((r) => r.row_id).sort()).toEqual([...own].sort())

      // 2. The owning leader attaches a photo to their own item.
      const up = await attach(tl1, item1)
      expect(up.status).toBe(201)
      const photo = (await up.json()) as Row
      uploaded.push(String(photo.file_url))
      expect(String(photo.file_url)).toMatch(/^\/private\/files\//)

      // 3. The other leader can neither list that File nor mint a URL for it.
      const files = (await (await tl2.fetch('/api/table/File?limit_page_length=200')).json()) as {
        data: Row[]
      }
      expect(files.data.map((r) => r.row_id)).not.toContain(photo.row_id)
      const url = `/api/signed_url?file_url=${encodeURIComponent(String(photo.file_url))}`
      expect((await tl2.fetch(url)).status).toBe(403)
      expect((await tl1.fetch(url)).status).toBe(200)

      // 4. Nor attach anything to it — refused BEFORE a storage object or a
      // File row exists.
      const [{ n: before }] = await sql`select count(*)::int as n from file`
      const bad = await attach(tl2, item1)
      expect(bad.status).toBe(403)
      const [{ n: after }] = await sql`select count(*)::int as n from file`
      expect(after).toBe(before)
    } finally {
      for (const url of uploaded) await deleteStored(url).catch(() => {})
      await unwire()
    }
  })
})

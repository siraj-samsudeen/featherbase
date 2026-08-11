// Checklists sample app: a reusable Checklist Template (the standard an
// operations owner defines once) instantiated as Checklist Runs (one
// execution per team per day). A run SNAPSHOTS the template's items at
// creation — a doc_events hook copies them in — so editing a template
// changes tomorrow's runs and never rewrites what was ticked yesterday.
//
// Like helpdesk, this is a genuine AppManifest: REGISTERED at boot but not
// installed; `POST /api/install_app { name: 'checklists' }` brings it up and
// uninstall removes exactly what install created. The manifest carries
// structure plus one fixture template (a retail section-opening checklist);
// demo runs live in scripts/seed-checklists.ts.
import type { AppManifest } from '../apps'
import type { HookContext } from '../controllers'
import { tableName } from '../doctype-engine'
import { AppError } from '../errors'

type ItemRow = Record<string, unknown>

// The run's snapshot as the SERVER holds it. Child rows are structure the
// server owns — a payload only ever proposes execution state on top of them —
// so every decision (progress, the submit gate) is taken against this, never
// against what a caller sent.
async function persistedItems(ctx: HookContext): Promise<ItemRow[]> {
  if (!ctx.row.row_id) return []
  return await ctx.tx`
    select * from ${ctx.tx(tableName('Checklist Run Item'))}
    where parent = ${String(ctx.row.row_id)}
      and parenttype = 'Checklist Run' and parentfield = 'items'
    order by position`
}

// By the time validation runs, prepareRun has already replaced any client
// array on ctx.row with its own reconciliation, so reading it back here is
// reading the server's own work. An absent key means "children untouched"
// (document.ts pickChildInputs), so fall back to the database.
async function effectiveItems(ctx: HookContext): Promise<ItemRow[]> {
  const items = ctx.row.items
  if (Array.isArray(items)) return items as ItemRow[]
  return await persistedItems(ctx)
}

const isDone = (it: ItemRow) => Boolean(it.done)
const hasNote = (it: ItemRow) => typeof it.note === 'string' && it.note.trim().length > 0

// done_at is a server stamp, never a client value: it survives across saves
// once set, appears the moment an item is ticked, and clears on untick.
// ISO string, not a Date — the child-row zod schema types Datetime as text.
function stampDoneAt(done: boolean, stored: unknown): string | null {
  if (!done) return null
  if (stored instanceof Date) return stored.toISOString()
  if (typeof stored === 'string' && stored) return new Date(stored).toISOString()
  return new Date().toISOString()
}

// Fold a client-proposed item array onto the persisted snapshot. The result
// always has exactly the stored rows, in stored order — so an omitted row
// can no longer delete a real item (saveChildren treats the payload as
// authoritative) and an invented row cannot add one. Only the tick and its
// excuse note travel from the client; the label and the must_do/photo_proof
// policy flags are snapshot structure and stay as the server recorded them.
function reconcileItems(stored: ItemRow[], proposed: ItemRow[]): ItemRow[] {
  const byName = new Map(
    proposed.filter((p) => p.row_id != null).map((p) => [String(p.row_id), p]),
  )
  return stored.map((row) => {
    const sent = byName.get(String(row.row_id))
    const done = sent && 'done' in sent ? Boolean(sent.done) : isDone(row)
    return {
      ...row,
      done,
      note: sent && 'note' in sent ? sent.note : row.note,
      done_at: stampDoneAt(done, isDone(row) ? row.done_at : null),
    }
  })
}

// before_validate on Checklist Run: enforce the terminal state, snapshot
// template items into a new run, default the run date, stamp/clear per-item
// tick times, derive progress and the run title. All mutations land on
// ctx.row before validation and the child-row save, inside the same
// transaction.
async function prepareRun(ctx: HookContext): Promise<void> {
  const row = ctx.row

  // A submitted run is finished: no late ticks, no added or removed items,
  // no photos, and no way back to Open. run_status is an ordinary Choice
  // column, so the engine's immutability guard — which watches the standard
  // `status` column — never sees this transition; the app owns the rule.
  if (!ctx.isNew && ctx.old?.run_status === 'Submitted')
    throw new AppError(
      'ValidationError',
      `${String(row.row_id ?? 'This run')} is submitted and can no longer be changed`,
      { run_status: 'A submitted run is final — start a new run instead' },
    )

  if (!row.run_date) row.run_date = new Date().toISOString().slice(0, 10)

  if (ctx.isNew) {
    // Items are STRUCTURE, and structure comes from the template — never
    // from the payload. Otherwise a caller could hand itself a checklist of
    // its own devising (or an empty one) and walk straight past the submit
    // gate. An unknown template leaves the run itemless; `template` is reqd,
    // so validation refuses it a moment later.
    const [template] = row.template
      ? await ctx.tx`
          select * from ${ctx.tx(tableName('Checklist Template'))}
          where row_id = ${String(row.template)}`
      : [undefined]
    const templateItems = template
      ? await ctx.tx`
          select * from ${ctx.tx(tableName('Checklist Template Item'))}
          where parent = ${String(row.template)}
            and parenttype = 'Checklist Template' and parentfield = 'items'
          order by position`
      : []
    row.items = templateItems.map((it) => ({
      item_label: it.item_label,
      must_do: Boolean(it.must_do),
      photo_proof: Boolean(it.photo_proof),
      done: false,
      done_at: null,
    }))
    if (template && !row.run_title) {
      const scope = [row.section, row.store].find((v) => typeof v === 'string' && v)
      row.run_title = scope
        ? `${template.template_name} — ${scope}`
        : String(template.template_name)
    }
  } else if (Array.isArray(row.items)) {
    row.items = reconcileItems(await persistedItems(ctx), row.items as ItemRow[])
  }

  // progress is derived, always — a client-sent value never survives. With
  // no items in the payload the children are untouched, so the stored rows
  // are what it counts.
  const items = Array.isArray(row.items) ? (row.items as ItemRow[]) : await persistedItems(ctx)
  row.progress = `${items.filter(isDone).length}/${items.length}`
}

// validate on Checklist Run: the submit gate. Moving to Submitted requires
// every must-do item to be ticked — or to carry a note saying why not.
async function enforceSubmitGate(ctx: HookContext): Promise<void> {
  const submitting =
    ctx.row.run_status === 'Submitted' && (ctx.old?.run_status ?? 'Open') !== 'Submitted'
  if (!submitting) return
  const items = await effectiveItems(ctx)
  const blocking = items.filter((it) => Boolean(it.must_do) && !isDone(it) && !hasNote(it))
  if (blocking.length)
    throw new AppError(
      'ValidationError',
      `${blocking.length} must-do item${blocking.length > 1 ? 's' : ''} left — tick them or add a note`,
      { run_status: blocking.map((it) => String(it.item_label)).join('; ') },
    )
}

const checklists: AppManifest = {
  name: 'checklists',
  tables: [
    {
      name: 'Checklist Template Item',
      module: 'Checklists',
      kind: 'sub_table',
      columns: [
        { column_name: 'item_label', label: 'Item', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'must_do', label: 'Must do', column_type: 'Check', in_list_view: true },
        { column_name: 'photo_proof', label: 'Photo proof', column_type: 'Check', in_list_view: true },
      ],
    },
    {
      name: 'Checklist Template',
      module: 'Checklists',
      id_pattern: 'CLT-.####',
      title_column: 'template_name',
      columns: [
        { column_name: 'template_name', label: 'Template', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'description', label: 'Description', column_type: 'Text' },
        { column_name: 'items', label: 'Items', column_type: 'Sub-table', row_table: 'Checklist Template Item' },
      ],
    },
    {
      name: 'Checklist Run Item',
      module: 'Checklists',
      kind: 'sub_table',
      columns: [
        { column_name: 'item_label', label: 'Item', column_type: 'Data', reqd: true, in_list_view: true },
        { column_name: 'must_do', label: 'Must do', column_type: 'Check', in_list_view: true },
        { column_name: 'photo_proof', label: 'Photo proof', column_type: 'Check' },
        { column_name: 'done', label: 'Done', column_type: 'Check', in_list_view: true },
        // Stamped by the prepareRun hook on the tick transition; cleared on
        // untick. A client-sent value is overwritten either way.
        { column_name: 'done_at', label: 'Done at', column_type: 'Datetime' },
        { column_name: 'note', label: 'Note', column_type: 'Data' },
      ],
    },
    {
      name: 'Checklist Run',
      module: 'Checklists',
      id_pattern: 'CLR-.#####',
      title_column: 'run_title',
      columns: [
        { column_name: 'run_title', label: 'Title', column_type: 'Data', in_list_view: true },
        { column_name: 'template', label: 'Template', column_type: 'Reference', reference_table: 'Checklist Template', reqd: true },
        { column_name: 'store', label: 'Store', column_type: 'Data' },
        { column_name: 'section', label: 'Section', column_type: 'Data', in_list_view: true },
        { column_name: 'team_leader', label: 'Team leader', column_type: 'Data', in_list_view: true },
        { column_name: 'run_date', label: 'Date', column_type: 'Date', in_list_view: true },
        {
          column_name: 'run_status', label: 'Status', column_type: 'Choice', in_list_view: true,
          choices: 'Open\nSubmitted', default_value: 'Open',
        },
        // Derived by prepareRun ("5/8") so list views and the checklist view
        // read completion without loading child rows.
        { column_name: 'progress', label: 'Progress', column_type: 'Data', in_list_view: true },
        { column_name: 'items', label: 'Items', column_type: 'Sub-table', row_table: 'Checklist Run Item' },
      ],
    },
  ],

  roles: ['Team Leader', 'Store Manager'],

  // Team leaders execute their OWN runs; store managers define templates and
  // see every run. Both may read child item rows directly (the File
  // signed-url check reads the row a photo is attached to) — a grant that is
  // safe because the engine reads a child row only as far as its PARENT is
  // readable, so a team leader's `own_rows_only` on Checklist Run reaches the
  // items too. Photos are the same story from the other side: a leader sees
  // the files THEY uploaded, and reaching anyone else's is refused at
  // /api/signed_url, which authorizes the row the photo hangs on.
  permissions: [
    { table: 'Checklist Template', role: 'Store Manager', can_read: true, can_write: true, can_create: true, can_delete: true },
    { table: 'Checklist Template', role: 'Team Leader', can_read: true },
    { table: 'Checklist Template Item', role: 'Store Manager', can_read: true },
    { table: 'Checklist Template Item', role: 'Team Leader', can_read: true },
    { table: 'Checklist Run', role: 'Store Manager', can_read: true, can_write: true, can_create: true, can_delete: true },
    { table: 'Checklist Run', role: 'Team Leader', own_rows_only: true, can_read: true, can_write: true, can_create: true },
    { table: 'Checklist Run Item', role: 'Store Manager', can_read: true },
    { table: 'Checklist Run Item', role: 'Team Leader', can_read: true },
    { table: 'File', role: 'Store Manager', can_read: true, can_write: true, can_create: true },
    { table: 'File', role: 'Team Leader', own_rows_only: true, can_read: true, can_write: true, can_create: true },
  ],

  doc_events: {
    'Checklist Run': {
      before_validate: prepareRun,
      validate: enforceSubmitGate,
    },
  },

  // One real template so the app is usable the moment it installs — a retail
  // section-opening checklist. No fixture name: the id pattern names it on
  // install, and uninstall removes exactly the row the install created.
  fixtures: [
    {
      table: 'Checklist Template',
      rows: [
        {
          template_name: 'Section Opening — Ground Floor',
          description:
            'Daily opening standard for a ground-floor section. Must-do items block submission unless ticked or explained with a note.',
          items: [
            { item_label: 'Aisle floor cleaned, no cartons in walkway', must_do: true },
            { item_label: 'All fixtures faced up and size-sequenced', must_do: true },
            { item_label: 'New arrivals on the entry table with price tags', must_do: true, photo_proof: true },
            { item_label: "Mannequins re-dressed per this week's VM note", photo_proof: true },
            { item_label: 'Fast movers from yesterday photographed for buyer', photo_proof: true },
            { item_label: 'Damaged/soiled pieces pulled to the holding rack', must_do: true },
            { item_label: 'Price-tag gun and spare tags at the counter' },
            { item_label: 'Trial-room hooks and mirrors checked', must_do: true },
          ],
        },
      ],
    },
  ],
}

export default checklists

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { sql } from './db'
import { AppError } from './errors'

// #101 Phase 3: the server half of recent actions. The client batches
// read-side intent (rows visited, lists filtered, searches run) into
// POST /api/events; rows land here by direct insert — same discipline as
// audit.ts (PLAT-007): append-only, never through saveDoc, so a user cannot
// rewrite their own trail. Reads go through eventSummary/the feed, always
// scoped to the caller. Raw events are pruned at RETENTION_DAYS; the client
// keeps its own warm mirror so nothing user-visible depends on old rows.

const RETENTION_DAYS = 90
// A client batch can arrive late (sendBeacon on unload, laptop lid) — trust
// its timestamps only within this window, clamp anything wilder.
const MAX_EVENT_AGE_MS = 7 * 86_400_000

const eventSchema = z.object({
  kind: z.enum(['row', 'list', 'page', 'search']),
  key: z.string().min(1).max(400),
  label: z.string().max(400).optional(),
  sub: z.string().max(400).optional(),
  path: z.string().max(1000).optional(),
  at: z.number().int().optional(),
})
const batchSchema = z.object({ events: z.array(eventSchema).min(1).max(50) })

export type IncomingEvent = z.infer<typeof eventSchema>

export function validateEventBatch(body: unknown): IncomingEvent[] {
  const parsed = batchSchema.safeParse(body)
  if (!parsed.success)
    throw new AppError('ValidationError', 'Expected { events: [{ kind, key, … }] } (max 50)')
  return parsed.data.events
}

function id(): string {
  return randomBytes(8).toString('hex')
}

export async function recordEvents(user: string, events: IncomingEvent[]): Promise<number> {
  const now = Date.now()
  const rows = events.map((e) => {
    const at = typeof e.at === 'number' ? Math.min(Math.max(e.at, now - MAX_EVENT_AGE_MS), now) : now
    return {
      name: id(),
      created_by: user,
      updated_by: user,
      created_at: new Date(now),
      updated_at: new Date(now),
      status: 'draft',
      kind: e.kind,
      ref_key: e.key,
      label: e.label ?? null,
      sub_label: e.sub ?? null,
      path: e.path ?? null,
      occurred_at: new Date(at),
    }
  })
  await sql`insert into user_event ${sql(rows)}`
  // Retention rides the write path: one indexed delete per batch keeps the
  // table bounded without a scheduler. Global on purpose — a dormant user's
  // trail must expire even though they never post another batch.
  await sql`
    delete from user_event
    where occurred_at < now() - make_interval(days => ${RETENTION_DAYS})`
  return rows.length
}

export interface EventSummaryEntry {
  kind: string
  key: string
  label: string
  sub?: string
  path: string
  /** Visit timestamps (epoch ms), oldest first, capped at 10 — the client
   *  buffer's exact shape, so cross-device merge is a union by key. */
  visits: number[]
}

// #101 Phase 5: routine detection. A "routine" is a set of destinations
// (lists, reports, dashboards — not individual rows) this user opens on many
// distinct days. Two or more such habitual targets make a suggestion the
// Home Page can offer to pin as a workspace; fewer means no routine, and the
// endpoint stays quiet.
const ROUTINE_WINDOW_DAYS = 14
const ROUTINE_MIN_DAYS = 5

export interface RoutineTarget {
  key: string
  label: string
  sub?: string
  path: string
  days: number
}

export async function routineSuggestion(user: string): Promise<RoutineTarget[]> {
  const rows = await sql`
    select ref_key, count(distinct date_trunc('day', occurred_at)) as days
    from user_event
    where created_by = ${user}
      and kind in ('list', 'page')
      and occurred_at > now() - make_interval(days => ${ROUTINE_WINDOW_DAYS})
    group by ref_key
    having count(distinct date_trunc('day', occurred_at)) >= ${ROUTINE_MIN_DAYS}
    order by days desc, ref_key
    limit 4`
  if (rows.length < 2) return []
  const keys = rows.map((r) => r.ref_key as string)
  const latest = await sql`
    select distinct on (ref_key) ref_key, label, sub_label, path
    from user_event
    where created_by = ${user} and ref_key in ${sql(keys)}
    order by ref_key, occurred_at desc`
  const byKey = new Map(latest.map((l) => [l.ref_key as string, l]))
  return rows.map((r) => {
    const meta = byKey.get(r.ref_key as string)
    return {
      key: r.ref_key as string,
      label: (meta?.label as string | null) ?? (r.ref_key as string),
      sub: (meta?.sub_label as string | null) ?? undefined,
      path: (meta?.path as string | null) ?? '',
      days: Number(r.days),
    }
  })
}

export async function eventSummary(user: string, scan = 800): Promise<EventSummaryEntry[]> {
  const rows = await sql`
    select kind, ref_key, label, sub_label, path, occurred_at
    from user_event
    where created_by = ${user}
    order by occurred_at desc
    limit ${scan}`
  const byKey = new Map<string, EventSummaryEntry>()
  for (const r of rows) {
    let entry = byKey.get(r.ref_key as string)
    if (!entry) {
      // Rows arrive newest-first, so the first row per key carries the
      // freshest label/path.
      entry = {
        kind: r.kind as string,
        key: r.ref_key as string,
        label: (r.label as string | null) ?? '',
        sub: (r.sub_label as string | null) ?? undefined,
        path: (r.path as string | null) ?? '',
        visits: [],
      }
      byKey.set(entry.key, entry)
    }
    if (entry.visits.length < 10) entry.visits.push(new Date(r.occurred_at as string).getTime())
  }
  for (const entry of byKey.values()) entry.visits.reverse()
  return [...byKey.values()]
}

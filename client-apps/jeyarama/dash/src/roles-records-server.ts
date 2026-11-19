// #1340: business roles in Featherbase's own list and record page, and Give Old Grants as a preview page. The
// platform draws these answers (its record facts); the rules behind them are the ones the Dash pages used: the role
// facts are businessRoles' own, and the preview is the plan the action runs, worked out without writing.
import { ACCESS_SOURCE, accessSource } from './access-source.ts'
import { PERMISSION, TITLE_MAP, businessModel, every, type Base } from './business-access.ts'
import { DASH_APP, permissionParts, type Reach } from './business-roles.ts'
import { businessRoles } from './business-roles-server.ts'
import { all, managesAccess, personNames, type AccessContext } from './report-access-server.ts'
import { planGrants, type PlannedGrant } from './switch-over.ts'
import { checked, exact, text } from './values.ts'
import { istToday } from './report.ts'

const ROLE_TABLE = 'dash.business_role'
/** Where Featherbase's preview of an action is (the platform's page). */
export const OLD_GRANTS_PAGE = `/featherbase/admin/table/${ROLE_TABLE}/run/give_old_grants_to_roles`
/** The roles × permissions grid of #1282, Dash's own page. */
export const GRID_PAGE = '/dash/?view=roles-grid'
/** The people of a role shown on its page before Show all. */
const PEOPLE_SENT = 20

const counted = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`
const joined = (words: string[]) => words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`

/** How people came to hold a role, in the list's short words. */
const GIVEN_BY: Record<string, string> = {
  'from HR title': 'HR title', 'from merchandise assignment': 'Merchandise', 'as buyer on a Buyer Section': 'Buyer Section',
  'as named cluster head': 'Cluster head', 'by hand': 'By hand',
}

type Roles = Awaited<ReturnType<typeof businessRoles>>['roles']

/** Record actions on the Business Role list: the two setup steps, the one switch and the grid, each said in a line. */
async function listActions(ctx: AccessContext) {
  const source = await accessSource(ctx.baseTables as Base)
  const switchRow = (await every(ctx.baseTables as Base, ACCESS_SOURCE, ['source']))[0]
  const live = source === 'business_roles'
  const systemManager = (ctx.roles ?? []).includes('System Manager')
  return [
    { key: 'starting_roles', label: 'Add The Starting Roles', run: 'add_starting_roles',
      explain: 'Creates the agreed roles and HR title maps that are missing. Running it again adds nothing.' },
    // As on the old page: only a System Manager may give the old grants, so only they are offered it.
    ...(systemManager ? [{ key: 'old_grants', label: 'Give Old Grants To Business Roles…', href: OLD_GRANTS_PAGE,
      explain: 'Shows what it would copy first; nothing is saved until Run.' }] : []),
    { key: 'access_source', label: `Dash Access Source: ${live ? 'Business Roles' : 'Old Rules'}`,
      href: switchRow ? `/featherbase/admin/table/${ACCESS_SOURCE}/row/${encodeURIComponent(exact(switchRow.row_id))}` : `/featherbase/admin/table/${ACCESS_SOURCE}`,
      explain: live ? 'The one switch. Set it to Old rules to put the old rules back.'
        : 'The one switch, on the old rules. After the owner\'s yes, a System Manager adds a row saying Business roles.' },
    { key: 'grid', label: 'Open As Grid', href: GRID_PAGE, explain: "Every role's permissions and reports side by side." },
    { key: 'runs', label: 'Setup Runs', href: '/featherbase/admin/table/dash.setup_run', explain: 'Each run of the setup steps, with its counts and what it did.' },
  ]
}

/** The groups of a role's Links tab: What They Can Do, Reports, HR Titles That Give It, People. */
async function roleGroups(ctx: AccessContext, role: Roles[number], roles: Roles, titles: { title: string; role: string | null; people: number }[]) {
  const permissionRows = (await all(ctx.baseTables!, PERMISSION, ['business_role', 'app', 'level', 'verb', 'thing', 'reach', 'removed'], [['business_role', '=', role.id]]))
    .filter(r => !checked(r.removed))
  const titleRows = (await every(ctx.baseTables as Base, TITLE_MAP, ['title', 'business_role'])).filter(r => exact(r.business_role) === role.id)
  const peopleOf = new Map(titles.map(t => [t.title.toLowerCase(), t.people]))
  const others = (given: string) => roles.filter(r => r.id !== role.id && r.given.includes(given)).map(r => r.name)
  return [
    { key: 'can', heading: 'What They Can Do', table: PERMISSION, links: [{ label: 'Open as grid', href: GRID_PAGE }],
      rows: Object.fromEntries(permissionRows.map(r => [exact(r.row_id), {
        parts: permissionParts(role, { verb: text(r.verb), thing: text(r.thing), reach: text(r.reach) as Reach }),
        note: [`In ${text(r.app)}, at level ${text(r.level)}`],
      }])) },
    { key: 'reports', heading: 'Reports', table: 'dash.report_access',
      // Each tick line says who else holds the same grant: the grant is one, each role sees its own area.
      notes: Object.fromEntries(role.given.map(given => {
        const also = others(given)
        return [given.slice(given.indexOf('|') + 1), also.length ? `Also given to ${joined(also)}, each in their own area` : 'Given to this role only']
      })) },
    { key: 'titles', heading: 'HR Titles That Give It', table: TITLE_MAP,
      rows: Object.fromEntries(titleRows.map(r => [exact(r.row_id), {
        parts: [{ record: { table: TITLE_MAP, row: exact(r.row_id), name: text(r.title) } }, ` → this role, for ${counted(peopleOf.get(text(r.title).toLowerCase()) ?? 0, 'person', 'people')}`],
        chip: { label: 'from HR', tone: 'quiet' as const },
      }])) },
    { key: 'people', heading: 'People', count: role.people,
      lines: role.holders.slice(0, PEOPLE_SENT).map(h => ({
        parts: [{ record: { table: 'Person', row: h.person, name: h.name } }],
        chip: h.by_hand ? { label: 'given by hand', tone: 'caution' as const } : { label: 'from HR', tone: 'quiet' as const },
      })) },
  ]
}

/**
 * The platform asks about rows of dash.business_role: the list's columns and Record actions, a record page's header
 * line and Links groups. Refused, as Business Roles was, to anyone but a Report Access Manager or System Manager:
 * the platform then draws its generic page.
 */
export async function describeBusinessRoles(context: AccessContext) {
  const { rows, page } = Object(context.payload) as { rows?: unknown; page?: unknown }
  const asked = new Set(Array.isArray(rows) ? rows.map(r => exact(r)) : [])
  const answer = await businessRoles(context)
  const described = answer.roles.filter(r => asked.has(r.id))
  return {
    version: 1,
    columns: [
      { key: 'people', label: 'People' }, { key: 'given_by', label: 'Given By' }, { key: 'can_do', label: 'What They Can Do' },
      { key: 'reports', label: 'Reports' }, { key: 'opens_dash', label: 'Opens Dash' },
    ],
    rows: Object.fromEntries(await Promise.all(described.map(async role => [role.id, {
      facts: {
        people: { text: role.people.toLocaleString('en-IN') },
        given_by: { text: role.given_by.map(w => GIVEN_BY[w] ?? w).join(' + ') || '—' },
        can_do: { text: counted(role.permissions.length, 'permission') },
        reports: { text: role.given.length ? role.given.length.toLocaleString('en-IN') : '—' },
        opens_dash: { text: role.permissions.some(p => p.app === DASH_APP) ? 'Yes' : 'No' },
      },
      header: `Business role · ${role.people ? `${counted(role.people, 'person', 'people')} · ${role.people_from}` : 'nobody yet'}`,
      ...(page === true && { groups: await roleGroups(context, role, answer.roles, answer.titles) }),
    }] as const))),
    actions: await listActions(context),
  }
}

/** The preview's filter for each outcome: Stays with the person is not carried over either. */
const FILTER: Record<PlannedGrant['outcome'], 'add' | 'there' | 'not'> = {
  'Will be added': 'add', 'Already there': 'there', 'Not carried over': 'not', 'Stays with the person': 'not',
}
const TONE: Record<PlannedGrant['outcome'], 'neutral' | 'quiet' | 'caution'> = {
  'Will be added': 'neutral', 'Already there': 'quiet', 'Not carried over': 'caution', 'Stays with the person': 'caution',
}

/**
 * #1340: what Give Old Grants To Business Roles would do, said before it runs: the action's own plan, written nowhere.
 * A Report Access Manager or System Manager may see it, as they saw the switch; only a System Manager may run it.
 */
export async function giveOldGrantsPreview(context: AccessContext) {
  if (!managesAccess(context)) context.reject!('Only a Report Access Manager or a System Manager can see what decides Dash access')
  const reports = new Map((await context.documents!.list('dash.report', { fields: ['report_key', 'report_name'], limit_page_length: 500 })).map(r => [exact(r.report_key), text(r.report_name)]))
  const bundles = new Map((await context.documents!.list('dash.report_bundle', { fields: ['row_id', 'bundle_name'], limit_page_length: 500 })).map(r => [exact(r.row_id), text(r.bundle_name)]))
  const { model } = await businessModel(context.baseTables!, istToday())
  const plan = await planGrants(context.baseTables!, model, reports)
  const roleName = new Map(model.roles.map(r => [r.id, r.name]))
  const people = await personNames(context, plan.filter(s => s.old.kind === 'person').map(s => s.old.name))
  // One line per old grant and what happens to it, its roles together.
  const lines = new Map<string, PlannedGrant & { roles: string[] }>()
  for (const step of plan) {
    const key = `${step.grant}|${step.outcome}`
    const line = lines.get(key) ?? { ...step, roles: [] }
    if (step.role) line.roles.push(step.role)
    lines.set(key, line)
  }
  const given = (s: PlannedGrant) => 'report' in s.gives
    ? reports.has(s.gives.report) ? { record: { table: 'dash.report', row: s.gives.report, name: reports.get(s.gives.report)! } } : 'A report no longer listed'
    : bundles.has(s.gives.report_bundle) ? { record: { table: 'dash.report_bundle', row: s.gives.report_bundle, name: bundles.get(s.gives.report_bundle)! } } : 'A bundle no longer listed'
  const oldGrant = (s: PlannedGrant) => s.old.kind === 'person'
    ? { parts: ['Person: ', { record: { table: 'Person', row: s.old.name, name: people.get(s.old.name) ?? 'Someone' } }] }
    : { text: s.old.kind === 'job' ? `Job: ${s.old.name}` : s.old.name }
  const toRoles = (ids: string[]) => ids.length
    ? { parts: ids.flatMap((id, i) => [...(i ? [i === ids.length - 1 ? ' and ' : ', '] : []), { record: { table: ROLE_TABLE, row: id, name: roleName.get(id) ?? 'A role' } }]) }
    : { text: '—' }
  const what: Record<PlannedGrant['outcome'], string> = {
    'Will be added': 'Will be added', 'Already there': 'Already there',
    'Not carried over': 'Not carried over: gives nothing while business roles decide', 'Stays with the person': 'Stays with the person',
  }
  const rows = [...lines.values()].map(line => ({ filter: FILTER[line.outcome], cells: {
    report: { parts: [given(line)] }, old_grant: oldGrant(line), given_to: toRoles(line.roles), what: { text: what[line.outcome], tone: TONE[line.outcome] },
  } }))
  const adding = [...lines.values()].filter(l => l.outcome === 'Will be added')
  const there = rows.filter(r => r.filter === 'there').length
  const toWhom = new Set(adding.flatMap(l => l.roles))
  const sentence = adding.length
    ? `Gives ${counted(adding.length, 'report')} to ${counted(toWhom.size, 'business role')}. ${there.toLocaleString('en-IN')} already there. Grants to people stay with the person.`
    : `Adds nothing: ${there ? 'every old grant it carries is already there' : 'no old grant is carried to a business role'}. Grants to people stay with the person.`
  return {
    version: 1,
    title: 'Give Old Grants To Business Roles',
    status: "Preview · nothing is saved until Run · nobody's access changes until the switch is set",
    sentence: [sentence],
    runLabel: 'Run',
    filters: [{ key: 'add', label: 'Will be added' }, { key: 'there', label: 'Already there' }, { key: 'not', label: 'Not carried over' }],
    columns: [{ key: 'report', label: 'Report' }, { key: 'old_grant', label: 'Old Grant' }, { key: 'given_to', label: 'Given To' }, { key: 'what', label: 'What Happens' }],
    rows,
    note: 'Running this again adds nothing; each run is kept in Setup Runs.',
  }
}

export const ACCESS_DECISION = 'dash.access_decision'

/** #1340: the people the owner has decided are to lose Dash with business roles, by person. Taken-back ones are not. */
export async function decidedToLose(base: Base): Promise<Set<string>> {
  return new Set((await every(base, ACCESS_DECISION, ['person', 'decision', 'removed']))
    .filter(r => !checked(r.removed) && text(r.decision) === 'Lose Dash').map(r => exact(r.person)))
}

/**
 * #1340: Let Them Lose Dash, on Who Would Gain Or Lose Access: the owner's decision for one person, recorded once. It
 * gives and takes away nothing; the person stops needing a decision. Kept to those who may see the page.
 */
export async function decideAccess(context: AccessContext) {
  if (!managesAccess(context)) context.reject!('Only a Report Access Manager or a System Manager can decide who loses Dash')
  const person = exact(Object(context.payload).person)
  if (!person) context.reject!('Choose a person')
  if ((await decidedToLose(context.baseTables as Base)).has(person)) return { person, decision: 'Lose Dash' }
  await context.documents!.create!(ACCESS_DECISION, { person, decision: 'Lose Dash', decided_by_name: text(context.userName) || null })
  return { person, decision: 'Lose Dash' }
}

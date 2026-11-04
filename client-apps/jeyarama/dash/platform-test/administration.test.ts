import { describe, expect } from 'vitest'
import { test } from '../pg-test'
import { expectApiError } from '../fixtures'
import { saveDoc, saveSystemRow } from '../../src/document'
import { provisionApp } from '../../src/app-lifecycle'
import { sql } from '../../src/db'
import { installApp, pinned, saveRow } from './helpers'

describe('configured store administration', () => {
  test.for(['original holder', 'successor', 'transfer'] as const)('delegated correction revalidates the %s', { timeout: 30_000 }, async (scenario, { admin, createUser }) => {
    await installApp(pinned(admin))
    const meera = pinned(await createUser({ roles: [] }))
    const arun = pinned(await createUser({ roles: [] }))
    const priya = pinned(await createUser({ roles: [], email: 'priya@contact.example' }))
    const ravi = pinned(await createUser({ roles: [] }))
    const seed = await provisionApp('feather_dash', async () => {
      const department = await saveDoc('feather_dash.department', { store: '9901', department_key: 'home', name: 'Homeware' })
      const section = await saveDoc('feather_dash.section', { store: '9901', section_name: 'Homeware essentials', department: department.row_id })
      const other = await saveDoc('feather_dash.section', { store: '9901', section_name: 'Clothing' })
      for (const row of [
        { person: meera.user, job: 'Store Manager' },
        { person: arun.user, job: 'Department Manager', department: department.row_id },
        { person: priya.user, job: 'Team Leader', section: section.row_id },
        { person: ravi.user, job: 'Team Leader', section: other.row_id },
      ]) await saveDoc('feather_dash.job_assignment', { ...row, store: '9901', starts_on: '2020-01-01' })
      const contacts: Record<string, Record<string, unknown>> = {}
      for (const [name, person] of Object.entries({ Arun: arun, Priya: priya, Ravi: ravi }))
        contacts[name] = await saveDoc('feather_dash.employee', { name, person: person.user,
          employee_number: `DEMO-${name}`, phone: name === 'Priya' ? 'priya@contact.example' : `phone-${name}`, emergency_contact: `contact-${name}` })
      const store = await saveSystemRow('Scope', { app: 'feather_dash', mode: 'named', tuples: [{ store: '9901' }] }, 'bootstrap')
      const home = await saveSystemRow('Scope', { app: 'feather_dash', mode: 'named', tuples: [{ store: '9901', department: department.row_id }] }, 'bootstrap')
      const self = await saveSystemRow('Scope', { app: 'feather_dash', mode: 'self' }, 'bootstrap')
      const authority = await saveSystemRow('Authority', { app: 'feather_dash', scope: store.row_id,
        holder_role: 'Store Manager', office_job: 'Store Manager', enabled: true }, 'bootstrap')
      for (const action of ['grant', 'revoke']) await saveSystemRow('Delegation Boundary', { app: 'feather_dash',
        authority: authority.row_id, required_role: 'Employee Contact Access Admin', action, target_role: 'Employee Contact Admin',
        max_scope: store.row_id, recipient_scope: store.row_id }, 'bootstrap')
      await saveSystemRow('Role Assignment', { app: 'feather_dash', person: arun.user, role: 'Employee Self-Service', scope: self.row_id }, 'bootstrap')
      return { contacts, home, authority, other }
    })
    const account = await sql`select * from featherbase.person where row_id = ${priya.user}`
    const identities = await sql`select * from featherbase.sign_in_identity where person_id = ${priya.user}`
    const table = 'feather_dash.employee'
    const path = (name: string) => `/api/table/${table}/${seed.contacts[name].row_id}`
    await expectApiError(arun.get(path('Priya')), { status: 403 })
    const grant = await meera.post<{ row_id: string }>('/api/administration/grant', {
      app: 'feather_dash', person: arun.user, role: 'Employee Contact Admin', scope: seed.home.row_id,
    })
    const contact = await arun.get<Record<string, unknown>>(path('Priya'))
    expect(contact).toMatchObject({ name: 'Priya', employee_number: 'DEMO-Priya', phone: 'priya@contact.example', emergency_contact: 'contact-Priya' })
    expect(contact).not.toHaveProperty('person')
    await expectApiError(arun.get(path('Ravi')), { status: 403 })
    await expectApiError(saveRow(arun, table, { row_id: contact.row_id, updated_at: contact.updated_at,
      phone: 'must-not-save', employee_number: 'must-not-change' }), { status: 403 })
    await expectApiError(saveRow(arun, table, { person: priya.user, name: 'Unauthorised employee',
      employee_number: 'DEMO-FORBIDDEN', phone: 'must-not-create' }), { status: 403 })
    const deletion = await arun.fetch(`${path('Priya')}?updated_at=${encodeURIComponent(String(contact.updated_at))}`, { method: 'DELETE' })
    expect(deletion.status).toBe(403)
    expect(await arun.get(path('Priya'))).toMatchObject({ phone: 'priya@contact.example' })
    const own = await arun.get<Record<string, unknown>>(path('Arun'))
    expect(await saveRow(arun, table, { row_id: own.row_id, updated_at: own.updated_at, phone: 'own-correction' }))
      .toMatchObject({ phone: 'own-correction' })
    const held = await saveRow(arun, table, { row_id: contact.row_id, updated_at: contact.updated_at, phone: 'operational-correction' })
    expect(held).toMatchObject({ outcome: 'pending_approval', version: 1 })
    expect(await arun.get(path('Priya'))).toMatchObject({ phone: 'priya@contact.example' })
    const decision = { proposal: held.proposal, version: held.version, decision: 'approve' }
    await expectApiError(arun.post('/api/administration/review', decision), { status: 403 })
    let reviewer = meera
    if (scenario !== 'original holder') {
      const [{ today }] = await sql`select (now() at time zone 'Asia/Kolkata')::date::text as today`
      const person = scenario === 'successor' ? meera.user : priya.user
      // The approved examples initialise the successor/transfer as trusted
      // staffing. All access and review assertions still use ordinary HTTP.
      await provisionApp('feather_dash', async () => {
        const [appointment] = await sql`select row_id, updated_at from feather_dash.job_assignment where person = ${person}`
        await saveDoc('feather_dash.job_assignment', { ...appointment, ends_on: today })
        await saveDoc('feather_dash.job_assignment', { person: scenario === 'successor' ? ravi.user : priya.user,
          job: scenario === 'successor' ? 'Store Manager' : 'Team Leader', store: '9901', starts_on: today,
          ...(scenario === 'transfer' ? { section: seed.other.row_id } : {}) })
      })
      if (scenario === 'transfer') {
        await expectApiError(arun.get(path('Priya')), { status: 403 })
        await expectApiError(meera.post('/api/administration/review', decision), { status: 403 })
        expect(await meera.get(path('Priya'))).toMatchObject({ phone: 'priya@contact.example' })
        return
      }
      await expectApiError(meera.post('/api/administration/review', decision), { status: 403 })
      expect(await arun.get(path('Priya'))).toMatchObject({ phone: 'priya@contact.example' })
      reviewer = ravi
    }
    expect(await reviewer.post('/api/administration/review', decision)).toMatchObject({ outcome: 'applied' })
    expect(await arun.get(path('Priya'))).toMatchObject({ phone: 'operational-correction' })
    const [history] = await sql`select data from featherbase.version where ref_table = ${table} and ref_name = ${String(contact.row_id)}`
    expect(history.data).toMatchObject({ approval: { proposal: held.proposal, maker: arun.user,
      reviewers: [reviewer.user], authorities: [seed.authority.row_id] } })
    expect((await sql`select grantor, authority, scope from featherbase.role_assignment where row_id = ${grant.row_id}`)[0])
      .toMatchObject({ grantor: meera.user, authority: seed.authority.row_id, scope: seed.home.row_id })
    expect(await sql`select * from featherbase.person where row_id = ${priya.user}`).toEqual(account)
    expect(await sql`select * from featherbase.sign_in_identity where person_id = ${priya.user}`).toEqual(identities)
    expect(await reviewer.post('/api/administration/revoke', { assignment: grant.row_id })).toMatchObject({ revoked: true })
    await expectApiError(arun.get(path('Priya')), { status: 403 })
  })

  test.for(['Store Manager', 'Department Manager', 'Team Leader'] as const)('%s maintains only its organisational mappings', { timeout: 30_000 }, async (job, { admin, createUser }) => {
    await installApp(pinned(admin))
    const manager = pinned(await createUser({ roles: [] }))
    const seeded = await provisionApp('feather_dash', async () => {
      const department = await saveDoc('feather_dash.department', { store: '9901', department_key: 'home', name: 'Home' })
      const other = await saveDoc('feather_dash.department', { store: '9901', department_key: 'clothing', name: 'Clothing' })
      const sections = []
      for (const [store, section_name, dept] of [['9901', 'Home A', department.row_id], ['9901', 'Home B', department.row_id],
        ['9901', 'Clothing', other.row_id], ['9902', 'Outside', null]])
        sections.push(await saveDoc('feather_dash.section', { store, section_name, department: dept }))
      await saveDoc('feather_dash.job_assignment', { person: manager.user, job, store: '9901', starts_on: '2020-01-01',
        ...(job === 'Department Manager' ? { department: department.row_id } : {}),
        ...(job === 'Team Leader' ? { section: sections[0].row_id } : {}) })
      const mappings = []
      for (const [index, section] of sections.entries()) mappings.push(await saveDoc('feather_dash.section_subcategory', {
        store: section.store, section: section.row_id, subcategory: `01010100${index + 1}`, starts_on: '2020-01-01',
      }))
      return { sections, mappings }
    })
    const table = 'feather_dash.section_subcategory'
    const expected = job === 'Store Manager' ? 3 : job === 'Department Manager' ? 2 : 1
    const listed = await manager.get<{ data: { row_id: string }[]; total: number }>(`/api/table/${table}?fields=${encodeURIComponent(JSON.stringify(['row_id']))}`)
    expect(listed.total).toBe(expected)
    expect(listed.data.map(row => row.row_id).sort()).toEqual(seeded.mappings.slice(0, expected).map(row => String(row.row_id)).sort())
    const current = await manager.get<Record<string, unknown>>(`/api/table/${table}/${seeded.mappings[0].row_id}`)
    await expectApiError(saveRow(manager, table, { row_id: current.row_id, updated_at: current.updated_at,
      store: '9902', section: seeded.sections[3].row_id }), { status: 403 })
    const move = () => saveRow(manager, table, { row_id: current.row_id, updated_at: current.updated_at,
      section: seeded.sections[1].row_id })
    if (job === 'Team Leader') await expectApiError(move(), { status: 403 })
    else expect(await move()).toMatchObject({ section: seeded.sections[1].row_id })
    const created = await saveRow(manager, table, { store: '9901', section: seeded.sections[0].row_id,
      subcategory: '010101099', starts_on: '2020-01-01' })
    expect(created).toMatchObject({ subcategory: '010101099', section: seeded.sections[0].row_id })
    const removed = await manager.fetch(`/api/table/${table}/${created.row_id}?updated_at=${encodeURIComponent(String(created.updated_at))}`, { method: 'DELETE' })
    expect(removed.ok).toBe(true)
    expect(await sql`select row_id from feather_dash.section_subcategory where row_id = ${String(created.row_id)}`).toEqual([])
  })
})

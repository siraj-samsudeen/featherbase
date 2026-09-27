import { describe, expect } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { runReportRows } from '../src/auto-email-report'
import { test, patchDoc } from './pg-test'
import { createUserWithRole, grantRole, makeTable, tableRef } from './fixtures'

const PARENT = 'Act Private Note'
const COMMENT = tableRef('Comment')
const VERSION = tableRef('Version')

async function removeImplicitActivityGrants() {
  await sql`delete from permission where ref_table in ('Comment', 'Version') and role = 'All'`
}

async function grantActivityRead(admin: TestClient, role: string) {
  await grantRole(admin, {
    role,
    table: ['Comment', 'Version'],
    can_read: true,
  })
}

async function addComment(admin: TestClient, rowId: string, content: string) {
  return admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Comment',
    row: { ref_table: PARENT, ref_name: rowId, content },
  })
}

async function editParent(
  admin: TestClient,
  rowId: string,
  values: Record<string, unknown>,
) {
  const current = await admin.get<Record<string, unknown>>(
    `/api/table/${encodeURIComponent(PARENT)}/${encodeURIComponent(rowId)}`,
  )
  return patchDoc(admin, `/api/table/${encodeURIComponent(PARENT)}/${encodeURIComponent(rowId)}`, {
    updated_at: current.updated_at,
    ...values,
  })
}

async function setupOwnerScope(admin: TestClient, createUser: CreateUserFn) {
  await removeImplicitActivityGrants()
  const parent = await makeTable(admin, {
    name: PARENT,
    id_pattern: 'prompt',
    columns: [
      'subject',
      { column_name: 'private_note', column_type: 'Data', tier: 'restricted' },
    ],
  })
  const user = await createUserWithRole(admin, createUser, {
    role: 'Act Owner Role',
    table: PARENT,
    own_rows_only: true,
    can_read: true,
    can_write: true,
    can_create: true,
  })
  await grantActivityRead(admin, 'Act Owner Role')
  await grantRole(admin, {
    role: 'Act Owner Role',
    table: 'Report',
    can_read: true,
  })
  const visible = await user.post<{ row_id: string }>(parent.url, {
    row_id: 'act-visible-parent',
    subject: 'Visible',
    private_note: 'visible-old-secret',
  })
  const hidden = await admin.post<{ row_id: string }>(parent.url, {
    row_id: 'act-hidden-parent',
    subject: 'Hidden',
    private_note: 'hidden-old-secret',
  })
  const visibleComment = await addComment(admin, visible.row_id, 'visible-comment-marker')
  const hiddenComment = await addComment(admin, hidden.row_id, 'hidden-comment-marker')
  await editParent(admin, visible.row_id, {
    subject: 'Visible edited',
    private_note: 'visible-new-secret',
  })
  await editParent(admin, hidden.row_id, {
    subject: 'Hidden edited',
    private_note: 'hidden-new-secret',
  })
  const versions = await admin.get<{
    data: { row_id: string; ref_name: string }[]
  }>(VERSION.listUrl({ fields: ['row_id', 'ref_name'], limit_page_length: 20 }))
  return {
    parent,
    user,
    visible: visible.row_id,
    hidden: hidden.row_id,
    visibleComment: visibleComment.row_id,
    hiddenComment: hiddenComment.row_id,
    visibleVersion: versions.data.find((row) => row.ref_name === visible.row_id)!.row_id,
    hiddenVersion: versions.data.find((row) => row.ref_name === hidden.row_id)!.row_id,
  }
}

describe('#342: generic activity inherits parent access', () => {
  test('lists, totals, details, counts, dashboard aggregates and search omit a hidden parent', async ({
    admin,
    createUser,
  }) => {
    const world = await setupOwnerScope(admin, createUser)

    const comments = await world.user.get<{
      data: { row_id: string; content: string; ref_name: string }[]
      total: number
    }>(
      COMMENT.listUrl({
        fields: ['row_id', 'content', 'ref_name'],
        order_by: 'created_at desc',
        limit_page_length: 1,
      }),
    )
    expect(comments).toMatchObject({
      total: 1,
      data: [
        {
          row_id: world.visibleComment,
          content: 'visible-comment-marker',
          ref_name: world.visible,
        },
      ],
    })
    await expect(world.user.get(COMMENT.rowUrl(world.hiddenComment))).rejects.toMatchObject({
      status: 403,
    })
    expect(await world.user.get(COMMENT.rowUrl(world.visibleComment))).toMatchObject({
      content: 'visible-comment-marker',
    })

    expect(await world.user.get<{ count: number }>(`${COMMENT.url}:count`)).toEqual({ count: 1 })
    expect(
      await world.user.post<{ count: number }>('/api/dashboard/count', { table: 'Comment' }),
    ).toEqual({ count: 1 })
    expect(
      await world.user.post<{ data: { label: string; value: number }[] }>(
        '/api/dashboard/chart',
        { table: 'Comment', group_by: 'ref_table' },
      ),
    ).toEqual({ data: [{ label: PARENT, value: 1 }] })
    expect(await world.user.get<{ count: number }>(`${COMMENT.url}:aggregate`)).toMatchObject({
      count: 1,
    })

    const visibleSearch = await world.user.get<{ results: { table: string; row_id: string }[] }>(
      `/api/search?q=${world.visibleComment}`,
    )
    expect(visibleSearch.results).toContainEqual({
      table: 'Comment',
      row_id: world.visibleComment,
      title: world.visibleComment,
    })
    const hiddenSearch = await world.user.get<{ results: { table: string; row_id: string }[] }>(
      `/api/search?q=${world.hiddenComment}`,
    )
    expect(hiddenSearch.results.some((hit) => hit.table === 'Comment')).toBe(false)

    const versionCount = await world.user.get<{ count: number }>(`${VERSION.url}:count`)
    expect(versionCount.count).toBe(1)
    await expect(world.user.get(VERSION.rowUrl(world.hiddenVersion))).rejects.toMatchObject({
      status: 403,
    })

    await admin.post('/api/save_row', {
      table: 'Report',
      row: {
        row_id: 'Act Comment Report',
        ref_table: 'Comment',
        report_type: 'Report Builder',
        config: { columns: ['content', 'ref_name'], filters: [] },
      },
    })
    const report = await runReportRows('Act Comment Report', String(world.user.user))
    expect(report.rows).toEqual([
      expect.objectContaining({
        content: 'visible-comment-marker',
        ref_name: world.visible,
      }),
    ])
  })

  test('direct and reference Data Scopes hide activity for excluded parents', async ({
    admin,
    createUser,
  }) => {
    await removeImplicitActivityGrants()
    const region = await makeTable(admin, {
      name: 'Act Region',
      id_pattern: 'prompt',
      columns: ['label'],
    })
    const parent = await makeTable(admin, {
      name: PARENT,
      id_pattern: 'prompt',
      columns: [
        'subject',
        { column_name: 'region', column_type: 'Reference', reference_table: region.name },
      ],
    })
    const user = await createUserWithRole(admin, createUser, {
      role: 'Act Scope Role',
      table: [PARENT, region.name],
      can_read: true,
    })
    await grantActivityRead(admin, 'Act Scope Role')
    await admin.post(region.url, { row_id: 'act-east', label: 'East' })
    await admin.post(region.url, { row_id: 'act-west', label: 'West' })
    await admin.post(parent.url, {
      row_id: 'act-east-parent',
      subject: 'East parent',
      region: 'act-east',
    })
    await admin.post(parent.url, {
      row_id: 'act-west-parent',
      subject: 'West parent',
      region: 'act-west',
    })
    await addComment(admin, 'act-east-parent', 'east-comment-marker')
    await addComment(admin, 'act-west-parent', 'west-comment-marker')
    await admin.post('/api/save_row', {
      table: 'Data Scope',
      row: { user: user.user, allow_table: region.name, for_value: 'act-east' },
    })

    const referenceScoped = await user.get<{ data: { content: string }[]; total: number }>(
      COMMENT.listUrl({ fields: ['content'], limit_page_length: 20 }),
    )
    expect(referenceScoped).toEqual(
      expect.objectContaining({ total: 1, data: [{ content: 'east-comment-marker' }] }),
    )

    const directUser = await createUser({ roles: ['Act Scope Role'] })
    await admin.post('/api/save_row', {
      table: 'Data Scope',
      row: { user: directUser.user, allow_table: PARENT, for_value: 'act-east-parent' },
    })

    const directScoped = await directUser.get<{ data: { content: string }[]; total: number }>(
      COMMENT.listUrl({ fields: ['content'], limit_page_length: 20 }),
    )
    expect(directScoped).toEqual(
      expect.objectContaining({ total: 1, data: [{ content: 'east-comment-marker' }] }),
    )
  })
})

describe('#342: shared and tier-filtered history', () => {
  test('a parent share enables document activity but not an ungranted generic activity list', async ({
    admin,
    createUser,
  }) => {
    await removeImplicitActivityGrants()
    const parent = await makeTable(admin, {
      name: PARENT,
      id_pattern: 'prompt',
      columns: [
        'subject',
        { column_name: 'private_note', column_type: 'Data', tier: 'restricted' },
      ],
    })
    await admin.post(parent.url, {
      row_id: 'act-shared-parent',
      subject: 'Shared before',
      private_note: 'shared-old-secret',
    })
    await addComment(admin, 'act-shared-parent', 'shared-comment-marker')
    await editParent(admin, 'act-shared-parent', {
      subject: 'Shared after',
      private_note: 'shared-new-secret',
    })
    const shareOnly = await createUser({ roles: [] })
    await admin.post('/api/save_row', {
      table: 'Share',
      row: {
        share_table: PARENT,
        share_name: 'act-shared-parent',
        user: shareOnly.user,
        read: true,
      },
    })

    const activity = await shareOnly.get<{
      comments: { content: string }[]
      versions: { data: { changed: [string, unknown, unknown][] } }[]
    }>(`/api/activity/${encodeURIComponent(PARENT)}/act-shared-parent`)
    expect(activity.comments).toEqual([expect.objectContaining({ content: 'shared-comment-marker' })])
    expect(activity.versions.flatMap((version) => version.data.changed)).toContainEqual([
      'subject',
      'Shared before',
      'Shared after',
    ])
    expect(JSON.stringify(activity)).not.toContain('shared-old-secret')
    expect(JSON.stringify(activity)).not.toContain('shared-new-secret')
    await expect(shareOnly.get(COMMENT.url)).rejects.toMatchObject({ status: 403 })

    await grantActivityRead(admin, 'Act Shared Activity Role')
    const genericReader = await createUser({ roles: ['Act Shared Activity Role'] })
    await admin.post('/api/save_row', {
      table: 'Share',
      row: {
        share_table: PARENT,
        share_name: 'act-shared-parent',
        user: genericReader.user,
        read: true,
      },
    })
    const generic = await genericReader.get<{ data: { content: string }[]; total: number }>(
      COMMENT.listUrl({ fields: ['content'], limit_page_length: 20 }),
    )
    expect(generic).toEqual(
      expect.objectContaining({ total: 1, data: [{ content: 'shared-comment-marker' }] }),
    )

    await grantRole(admin, {
      role: 'Act Shared Restricted Role',
      table: PARENT,
      tier: 'restricted',
      can_read: true,
    })
    const elevated = await createUser({ roles: ['Act Shared Restricted Role'] })
    await admin.post('/api/save_row', {
      table: 'Share',
      row: {
        share_table: PARENT,
        share_name: 'act-shared-parent',
        user: elevated.user,
        read: true,
      },
    })
    const elevatedActivity = await elevated.get(
      `/api/activity/${encodeURIComponent(PARENT)}/act-shared-parent`,
    )
    expect(JSON.stringify(elevatedActivity)).toContain('shared-old-secret')
    expect(JSON.stringify(elevatedActivity)).toContain('shared-new-secret')
  })

  test('generic and dedicated Version responses preserve role-granted fields and strip others', async ({
    admin,
    createUser,
  }) => {
    const world = await setupOwnerScope(admin, createUser)
    const activity = await world.user.get<{
      versions: { data: { changed: [string, unknown, unknown][] } }[]
    }>(`/api/activity/${encodeURIComponent(PARENT)}/${world.visible}`)
    const dedicatedJson = JSON.stringify(activity)
    expect(dedicatedJson).toContain('Visible edited')
    expect(dedicatedJson).not.toContain('visible-old-secret')
    expect(dedicatedJson).not.toContain('visible-new-secret')

    const list = await world.user.get<{
      data: { row_id: string; data: { changed: [string, unknown, unknown][] } }[]
    }>(VERSION.listUrl({ fields: ['row_id', 'data'], limit_page_length: 20 }))
    expect(list.data).toHaveLength(1)
    expect(JSON.stringify(list)).toContain('Visible edited')
    expect(JSON.stringify(list)).not.toContain('visible-old-secret')
    expect(JSON.stringify(list)).not.toContain('visible-new-secret')

    const detail = await world.user.get<Record<string, unknown>>(
      VERSION.rowUrl(world.visibleVersion),
    )
    expect(JSON.stringify(detail)).toContain('Visible edited')
    expect(JSON.stringify(detail)).not.toContain('visible-old-secret')
    expect(JSON.stringify(detail)).not.toContain('visible-new-secret')
  })

  test('Settings activity requires access to the single parent row', async ({
    admin,
    createUser,
  }) => {
    await removeImplicitActivityGrants()
    await makeTable(admin, {
      name: 'Act Visible Settings',
      kind: 'settings',
      columns: ['label'],
    })
    await makeTable(admin, {
      name: 'Act Hidden Settings',
      kind: 'settings',
      columns: ['label'],
    })
    const user = await createUserWithRole(admin, createUser, {
      role: 'Act Settings Role',
      table: 'Act Visible Settings',
      can_read: true,
    })
    await grantActivityRead(admin, 'Act Settings Role')
    await admin.post('/api/save_row', {
      table: 'Comment',
      row: {
        ref_table: 'Act Visible Settings',
        ref_name: 'Act Visible Settings',
        content: 'visible-settings-comment',
      },
    })
    await admin.post('/api/save_row', {
      table: 'Comment',
      row: {
        ref_table: 'Act Hidden Settings',
        ref_name: 'Act Hidden Settings',
        content: 'hidden-settings-comment',
      },
    })

    const comments = await user.get<{ data: { content: string }[]; total: number }>(
      COMMENT.listUrl({ fields: ['content'], limit_page_length: 20 }),
    )
    expect(comments).toEqual(
      expect.objectContaining({ total: 1, data: [{ content: 'visible-settings-comment' }] }),
    )
  })
})

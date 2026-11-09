import { readFileSync } from 'node:fs'
import { test } from './pg-test'
import { expect } from 'vitest'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { expectRefused, patchDoc } from './fixtures'

test('Email Sink reading metadata leaves authorization intact', async ({ admin, createUser }) => {
  await sql`insert into email_sink (row_id, mail_from, mail_to, subject, body)
    values ('reading-mail', 'accounts@example.test', 'priya@example.test', 'Invoice', 'Private body')`
  const meta = await admin.get<{ system_written: boolean; reading_presentation: unknown }>('/api/table/Email%20Sink:meta')
  expect(meta.system_written).toBe(true)
  expect(meta.reading_presentation).toMatchObject({ title: 'subject', body: 'body', headers: ['mail_from', 'mail_to', 'created_at'] })
  expect(await admin.get('/api/table/Email%20Sink/reading-mail')).toMatchObject({ body: 'Private body' })
  const user = await createUser({ roles: [] })
  await expectRefused(user.get('/api/table/Email%20Sink/reading-mail'), 403)
  await expectRefused(user.get('/api/table/Email%20Sink:meta'), 403)
  for (const write of [
    () => admin.post('/api/table/Email%20Sink', { subject: 'Forged' }),
    () => patchDoc(admin, '/api/table/Email%20Sink/reading-mail', { body: 'Forged' }),
    () => admin.delete('/api/table/Email%20Sink/reading-mail'),
    () => admin.post('/api/save_row', { table: 'Email Sink', row: { row_id: 'reading-mail', body: 'Forged' } }),
  ]) await expect(write()).rejects.toMatchObject({ status: 403 })
  expect(await admin.get('/api/table/Email%20Sink/reading-mail')).toMatchObject({ body: 'Private body' })
})

test('reading roles round-trip through the Table definition contract', async ({ admin }) => {
  const columns = [
    { column_name: 'title', column_type: 'Data' },
    { column_name: 'message', column_type: 'Text' },
  ]
  const reading = { title: 'title', headers: ['created_at'], body: 'message' }
  await admin.post('/api/table_def', { name: 'Reading Note', columns, reading_presentation: reading })
  expect(await admin.get('/api/table/Reading%20Note:meta')).toMatchObject({ reading_presentation: reading })
  await admin.put('/api/table_def/Reading%20Note', { columns, reading_presentation: { ...reading, body: 'title' } })
  expect(await admin.get('/api/table/Reading%20Note:meta')).toMatchObject({ reading_presentation: { ...reading, body: 'title' } })
  await expect(admin.put('/api/table_def/Reading%20Note', { columns, reading_presentation: { ...reading, body: 'absent' } }))
    .rejects.toMatchObject({ status: 417 })
  await expect(admin.put('/api/table_def/Reading%20Note', { columns, reading_presentation: { ...reading, html: true } }))
    .rejects.toMatchObject({ status: 417 })
  await admin.put('/api/table_def/Reading%20Note', { columns, reading_presentation: null })
  expect(await admin.get('/api/table/Reading%20Note:meta')).toMatchObject({ reading_presentation: null })
})

test('reading migration preserves authored labels and translated source keys', async ({ admin }) => {
  // Rehearse the forward migration in the test transaction on a pre-change shape.
  await sql`alter table table_def drop column reading_presentation`
  await sql`update column_def set label = column_name where parent = 'Email Sink'`
  await sql`update column_def set label = 'Our subject' where parent = 'Email Sink' and column_name = 'subject'`
  await sql`update column_def set custom = true where parent = 'Email Sink' and column_name = 'mail_from'`
  await sql`insert into translation (row_id, language, source_text, translated_text)
    values ('reading-translation', 'fr', 'body', 'Message traduit')`
  await sql`insert into email_sink (row_id, subject, body, attachment_names, attachment_b64)
    values ('pre-reading', 'Existing message', 'Original body', 'invoice.pdf', 'cGRm')`
  await sql.unsafe(readFileSync(new URL('../migrations/0013_reading_presentation.sql', import.meta.url), 'utf8'))
  invalidateMeta()
  const [row] = await sql`select body, attachment_names, attachment_b64 from email_sink where row_id = 'pre-reading'`
  expect(row).toMatchObject({ body: 'Original body', attachment_names: 'invoice.pdf', attachment_b64: 'cGRm' })
  const labels = await sql`select column_name, label from column_def where parent = 'Email Sink'`
  expect(Object.fromEntries(labels.map(row => [row.column_name, row.label]))).toMatchObject({
    subject: 'Our subject', mail_from: 'mail_from', mail_to: 'To', body: 'body', attachment_names: 'Attachments',
  })
  expect(await admin.get('/api/table/Email%20Sink:meta')).toMatchObject({ reading_presentation: { body: 'body' } })
})

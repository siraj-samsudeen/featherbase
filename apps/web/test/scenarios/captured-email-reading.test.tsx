// captured-email-reading's fenced scenarios (#1070), rendered in jsdom
// against the real in-process server. Each test is one scenario of
// openspec/specs/captured-email-reading/spec.md, step by step: an email the
// instance captured locally reads as an email, inert.
//
// jsdom lays nothing out and loads no images: that the long line fits its
// reading area is measured only in a real browser. Here the body keeps its
// line breaks and is styled to wrap them (white-space: pre-wrap), and no
// element that could load anything is rendered at all.
import { screen, within } from '@testing-library/react'
import { describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { rowHref } from 'shared'
import { sql } from 'server/src/db'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderSession, byTestId, type Session } from '../pg-test'

const scenario = scenarioFor(test, 'captured-email-reading')

const NORMAL_BODY = 'Hello Priya,\n\nYour invoice is ready.\nThank you,\nAccounts'
const UNSAFE_BODY = '<img src="https://email-tracker.invalid/pixel" onerror="window.emailExecuted=true">\n<script>window.emailExecuted=true</script>\n' + 'long-line-'.repeat(180)
const NAMES = 'invoice.pdf, terms.txt'

/** The captured invoice notice, as the instance's Email Sink keeps it. */
async function seed(variant: 'normal' | 'empty' | 'unsafe') {
  const body = variant === 'empty' ? '' : variant === 'unsafe' ? UNSAFE_BODY : NORMAL_BODY
  const names = variant === 'empty' ? null : NAMES
  const id = `invoice-${variant}`
  await sql`insert into email_sink
    (row_id, created_by, updated_by, mail_from, mail_to, subject, body, attachment_names, attachment_b64)
    values (${id}, 'Administrator', 'Administrator', 'accounts@example.test', 'priya@example.test',
    'Your November invoice', ${body}, ${names}, ${names ? 'aW52b2ljZQ==' : null})`
  return { id, body, names }
}

async function open(admin: TestClient, id: string): Promise<{ session: Session; reading: HTMLElement }> {
  const { session } = await renderSession(rowHref('Email Sink', id), admin)
  return { session, reading: await screen.findByTestId('reading-presentation', {}, { timeout: 8000 }) }
}
const READING = byTestId('reading-presentation')

describe('captured-email-reading', () => {
  scenario('Read a captured invoice notice', async ({ admin }, step) => {
    let notice: Awaited<ReturnType<typeof seed>>
    let session!: Session
    let reading: HTMLElement
    await step('the user can read the locally captured invoice notice', async () => { notice = await seed('normal') })
    await step('the user opens the captured invoice notice', async () => { ({ session, reading } = await open(admin, notice.id)) })
    await step('the user reads the invoice notice as an email with its attachment names', () => {
      // Visible, exact and absent: the DSL's text verbs check containment in the text, shown or hidden.
      expect(within(reading).getByRole('heading', { name: 'Your November invoice' })).toBeVisible()
      for (const text of ['accounts@example.test', 'priya@example.test', NAMES]) expect(within(reading).getByText(text, { exact: true })).toBeVisible()
      expect(within(reading).getByTestId('reading-body').textContent).toBe(notice.body)
      expect(within(reading).getByTestId('reading-header-created_at').textContent).not.toBe('')
      expect(within(reading).queryAllByRole('link')).toHaveLength(0)
    })
    await step('the user is told that local capture does not confirm external delivery', () =>
      session.within(READING, (email) => email.assertText('Captured locally in Email Sink. This does not confirm external delivery.')))
    await step('raw values are initially collapsed and cannot be edited', async () => {
      const details = screen.getByTestId('raw-details') as HTMLDetailsElement
      expect(details.open).toBe(false)
      await session.within(byTestId('raw-details'), (raw) => raw.click('Raw details'))
      // A value the user can't edit: shown as a value (#795) or as a disabled
      // control; either way nothing in it accepts input.
      for (const column of ['body', 'attachment_b64']) {
        const field = details.querySelector(`[data-field="${column}"], [data-form-field="${column}"]`)
        expect(field, `${column} is shown`).not.toBeNull()
        const editable = [field!, ...field!.querySelectorAll('*')].filter((el) =>
          (el.matches('input, textarea, select') && !(el as HTMLInputElement).disabled) || el.getAttribute('contenteditable') === 'true')
        expect(editable, `${column} can be edited`).toHaveLength(0)
      }
      for (const id of ['form-save', 'form-delete', 'form-rename']) expect(screen.queryByTestId(id)).toBeNull()
    })
  })

  scenario('Read an empty captured invoice notice', async ({ admin }, step) => {
    let notice: Awaited<ReturnType<typeof seed>>
    let session!: Session
    await step('the user can read the locally captured invoice notice without a message or attachments', async () => { notice = await seed('empty') })
    await step('the user opens the captured invoice notice', async () => { ({ session } = await open(admin, notice.id)) })
    await step('the user sees that there is no message body and no attachments', () =>
      session.within(READING, (email) => email.assertText('No message body').assertText('No attachments')))
  })

  scenario('Read an invoice notice containing markup', async ({ admin }, step) => {
    let notice: Awaited<ReturnType<typeof seed>>
    let reading: HTMLElement
    await step('the user can read the locally captured invoice notice containing unsafe markup and a long line', async () => { notice = await seed('unsafe') })
    await step('the user opens the captured invoice notice', async () => { ({ reading } = await open(admin, notice.id)) })
    // What is rendered, not what it reads: element counts, text whole and its classes are beyond the DSL.
    await step('the markup remains visible text without executable content or remote requests', () => {
      expect(within(reading).getByTestId('reading-body').textContent).toBe(notice.body)
      expect(reading.querySelectorAll('img,script,iframe,object,embed,link,style')).toHaveLength(0)
      expect(document.querySelectorAll('img[src*="email-tracker.invalid"], script[src*="email-tracker.invalid"]')).toHaveLength(0)
      expect((window as unknown as { emailExecuted?: boolean }).emailExecuted).toBeUndefined()
    })
    await step('the message preserves line breaks and fits its reading area', () => {
      const body = within(reading).getByTestId('reading-body')
      expect(body.textContent!.split('\n')).toHaveLength(3)
      expect(body.className).toContain('whitespace-pre-wrap')
      expect(body.className).toContain('[overflow-wrap:anywhere]')
    })
  })
})

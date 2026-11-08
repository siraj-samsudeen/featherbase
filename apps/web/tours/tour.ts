// The tour harness (#1070). A tour is one `tour(...)` test: a story told in
// chapters, each a `chapter(...)` with a time limit. Everything goes through
// the screen as a person does it; the only setup is the people who sign in.
//
// What a tour catches beyond its own assertions (the watchdog): any uncaught
// page error, any server error (5xx), any request that never got an answer,
// and any chapter slower than its limit. Those are what broke the demos while
// every narrow test stayed green.
//
// VIDEO=1 turns the same run into a product video: slow, with a title card
// per chapter and each step as a caption. `gap(...)` marks a step the
// platform can't do yet: a card in the video, an annotation in the report,
// never a failure.
import { test as base, expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'

export { expect }

const VIDEO = process.env.VIDEO === '1'
const CARD_MS = Number(process.env.VIDEO_CARD_MS ?? 2500)
const CAPTION_MS = Number(process.env.VIDEO_CAPTION_MS ?? 900)
export const ADMIN = { user: 'Administrator', password: process.env.ADMIN_PASSWORD ?? 'admin' }

// ---------------------------------------------------------------- watchdog

type Problem = string

function watch(page: Page, problems: Problem[], who: string): void {
  page.on('pageerror', (e) => problems.push(`${who}: page error: ${e.message}`))
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`${who}: ${r.status()} from ${r.request().method()} ${new URL(r.url()).pathname}`)
  })
  page.on('requestfailed', (r) => {
    const failure = r.failure()?.errorText ?? ''
    // A navigation cancels the requests of the page it leaves; that's not a fault.
    if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(failure)) return
    problems.push(`${who}: request failed: ${r.method()} ${new URL(r.url()).pathname} (${failure})`)
  })
}

// ---------------------------------------------------------------- captions

async function overlay(page: Page, kind: 'card' | 'caption', text: string, sub = ''): Promise<void> {
  await page
    .evaluate(
      ([kind, text, sub]) => {
        const id = 'tour-overlay'
        document.getElementById(id)?.remove()
        const el = document.createElement('div')
        el.id = id
        el.setAttribute('aria-hidden', 'true')
        const card = kind === 'card'
        el.style.cssText = card
          ? 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(17,24,39,.92);color:#fff;font:600 34px system-ui,sans-serif;text-align:center;padding:40px;pointer-events:none'
          : 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;max-width:80%;background:rgba(17,24,39,.88);color:#fff;font:500 17px system-ui,sans-serif;padding:10px 18px;border-radius:10px;pointer-events:none;text-align:center'
        el.textContent = text
        if (sub) {
          const s = document.createElement('div')
          s.style.cssText = card ? 'margin-top:14px;font:400 20px system-ui,sans-serif;opacity:.85;max-width:900px' : 'font-weight:400;opacity:.8'
          s.textContent = sub
          el.appendChild(s)
        }
        document.body.appendChild(el)
      },
      [kind, text, sub] as const,
    )
    .catch(() => undefined) // a page mid-navigation simply misses its caption
}

async function clearOverlay(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById('tour-overlay')?.remove()).catch(() => undefined)
}

// ---------------------------------------------------------------- the story

export interface Person {
  user: string
  password: string
  fullName: string
}

export interface Story {
  /** A titled part of the story, which must finish within `limitMs` (not enforced with VIDEO=1). */
  chapter(title: string, limitMs: number, body: () => Promise<void>, subtitle?: string): Promise<void>
  /** One action or check inside a chapter; its text is the video's caption. */
  step(text: string, body: () => Promise<void>): Promise<void>
  /** The start of a part of the story: a card in the video and a note in the report. */
  part(title: string, subtitle?: string): Promise<void>
  /** A step the platform can't do yet: a card in the video and a note in the report. */
  gap(title: string, issue: number, what: string): Promise<void>
  /** Another person's browser, signed in, watched like the first. */
  as(person: Person): Promise<Page>
  /** The page the story is currently shown on. */
  readonly page: Page
}

async function signIn(page: Page, person: Pick<Person, 'user' | 'password'>): Promise<void> {
  await page.goto('/featherbase/login?next=/featherbase/admin')
  await page.getByLabel('Email or username').fill(person.user)
  await page.getByLabel('Password').fill(person.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/**
 * The people a tour starts with are the install's, not the story's: made by
 * the Administrator through the API, as a fresh instance's welcome step would.
 */
export async function ensurePerson(request: APIRequestContext, p: Person & { roles: string[] }): Promise<void> {
  const login = await request.post('/api/login', { data: { usr: ADMIN.user, pwd: ADMIN.password } })
  expect(login.ok(), `Administrator signs in: ${await login.text()}`).toBe(true)
  const { token } = (await login.json()) as { token: string }
  const headers = { Authorization: `Bearer ${token}` }
  const made = await request.post('/api/save_row', {
    headers,
    data: { table: 'Person', row: { email: p.user, full_name: p.fullName, enabled: true, roles: p.roles.map((role) => ({ role })) } },
  })
  // A rerun against a long-lived instance (TOUR_URL) finds the person there already.
  if (made.status() !== 201 && !/already exists|duplicate/i.test(await made.text())) {
    throw new Error(`create ${p.user}: ${made.status()} ${await made.text()}`)
  }
  const id = made.status() === 201 ? ((await made.json()) as { row_id: string }).row_id : p.user
  const pw = await request.post('/api/set_password', { headers, data: { user: id, password: p.password } })
  expect(pw.ok(), `set ${p.user}'s password: ${await pw.text()}`).toBe(true)
}

export const tour = base.extend<{ story: (lead: Person) => Promise<Story> }>({
  story: async ({ page, browser }, use, testInfo: TestInfo) => {
    const problems: Problem[] = []
    const extra: Page[] = []
    let current = page
    watch(page, problems, 'lead')

    const make = async (lead: Person): Promise<Story> => {
      await signIn(page, lead)
      const story: Story = {
        get page() {
          return current
        },
        async chapter(title, limitMs, body, subtitle = '') {
          await base.step(title, async () => {
            if (VIDEO) {
              await overlay(current, 'card', title, subtitle)
              await current.waitForTimeout(CARD_MS)
              await clearOverlay(current)
            }
            const started = Date.now()
            const before = problems.length
            await body()
            const took = Date.now() - started
            const timing = `${title} — ${(took / 1000).toFixed(1)} s (limit ${limitMs / 1000} s)`
            testInfo.annotations.push({ type: 'chapter', description: timing })
            console.log(`  chapter: ${timing}`)
            expect(problems.slice(before), `no page or server errors during "${title}"`).toEqual([])
            if (!VIDEO) expect(took, `"${title}" took ${took} ms; its limit is ${limitMs} ms`).toBeLessThanOrEqual(limitMs)
          })
        },
        async step(text, body) {
          await base.step(text, async () => {
            if (VIDEO) {
              await overlay(current, 'caption', text)
              await current.waitForTimeout(CAPTION_MS)
            }
            const started = Date.now()
            await body()
            if (process.env.TOUR_STEP_TIMES) console.log(`    step: ${text} — ${((Date.now() - started) / 1000).toFixed(1)} s`)
            if (VIDEO) {
              await overlay(current, 'caption', text)
              await current.waitForTimeout(CAPTION_MS)
              await clearOverlay(current)
            }
          })
        },
        async part(title, subtitle = '') {
          testInfo.annotations.push({ type: 'part', description: title })
          console.log(`  part: ${title}`)
          if (VIDEO) {
            await overlay(current, 'card', title, subtitle)
            await current.waitForTimeout(CARD_MS * 1.5)
            await clearOverlay(current)
          }
        },
        async gap(title, issue, what) {
          await base.step(`Not yet: ${title} (#${issue})`, async () => {
            testInfo.annotations.push({ type: 'gap', description: `${title} — #${issue}: ${what}` })
            if (VIDEO) {
              await overlay(current, 'card', `Not yet: ${title}`, `${what} (#${issue})`)
              await current.waitForTimeout(CARD_MS * 1.5)
              await clearOverlay(current)
            }
          })
        },
        async as(person) {
          const ctx = await browser.newContext({
            baseURL: testInfo.project.use.baseURL,
            viewport: testInfo.project.use.viewport ?? undefined,
            ...(VIDEO ? { recordVideo: { dir: testInfo.outputPath('videos'), size: { width: 1280, height: 800 } } } : {}),
          })
          const p = await ctx.newPage()
          watch(p, problems, person.fullName)
          await signIn(p, person)
          extra.push(p)
          current = p
          return p
        },
      }
      return story
    }

    await use(make)

    // Whatever was left over after the last chapter still counts.
    expect(problems, 'no page or server errors anywhere in the tour').toEqual([])
    for (const p of extra) await p.context().close()
  },
})

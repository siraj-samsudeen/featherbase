// The harness checks itself: a tour must fail when a page throws, even if
// every assertion of its own passes. Expected to fail; Playwright reports it
// as passed while it does.
import { ADMIN, tour } from './tour'

tour('the watchdog fails a tour whose page throws', async ({ story }) => {
  tour.fail()
  const s = await story({ user: ADMIN.user, password: ADMIN.password, fullName: 'Administrator' })
  await s.chapter('A page throws an error nobody asserts on', 10_000, async () => {
    await s.page.evaluate(() => setTimeout(() => { throw new Error('thrown by the page') }, 0))
    await s.page.waitForTimeout(300)
  })
})

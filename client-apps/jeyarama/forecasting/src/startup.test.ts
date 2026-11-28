import { describe, expect, it } from 'vitest'
import { hostedStart } from './startup'

const refused = (status: number) => async () => { throw Object.assign(new Error('refused'), { status }) }

describe('how a hosted instance on the read-only copies opens (#1419)', () => {
  it('opens once an official Run is loaded, and says No Run when the copy is readable but empty', async () => {
    expect(await hostedStart(async () => [{ run_id: 'r' }])).toBe('open')
    expect(await hostedStart(async () => [])).toBe('no-run')
  })
  it('says the person has no access when the copy refuses the read (no Forecasting Member), not No Run', async () => {
    expect(await hostedStart(refused(403))).toBe('no-access')
  })
  it('lets any other failure through to the page’s own handling (a sign-in, a broken connection)', async () => {
    await expect(hostedStart(refused(401))).rejects.toMatchObject({ status: 401 })
  })
})

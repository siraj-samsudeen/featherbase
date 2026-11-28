import { describe, expect, it } from 'vitest'
import { hostedStart, startFailure } from './startup'
import { NO_PLACES } from './scoped'

const refused = (status: number) => async () => { throw Object.assign(new Error('refused'), { status }) }

describe('how a hosted instance on the read-only copies opens (#1419)', () => {
  it('opens once an official Run is loaded, and says No Run when the copy is readable but empty', async () => {
    expect(await hostedStart(async () => [{ run_id: 'r' }])).toBe('open')
    expect(await hostedStart(async () => [])).toBe('no-run')
  })
  it('says the person has no access when the copy refuses the read (no Forecasting Member), not No Run', async () => {
    expect(await hostedStart(refused(403))).toBe('no-access')
  })
  it('says the same to someone with no place on the org chart (#1454)', async () => {
    expect(await hostedStart(async () => { throw Object.assign(new Error(NO_PLACES), { status: 417 }) })).toBe('no-access')
    // any other refused read is not taken for no access
    await expect(hostedStart(async () => { throw Object.assign(new Error('Dataset forecast_run cannot be filtered on x'), { status: 417 }) })).rejects.toThrow(/cannot be filtered/)
  })
  it('lets any other failure through to the page’s own handling (a sign-in, a broken connection)', async () => {
    await expect(hostedStart(refused(401))).rejects.toMatchObject({ status: 401 })
  })
})

describe('when the first reads fail (28-Nov)', () => {
  const fail = (status: number, message = 'x') => Object.assign(new Error(message), { status })
  it('signs in again on a lapsed sign-in, here or hosted', () => {
    expect(startFailure(fail(401), false)).toBe('sign-in')
    expect(startFailure(fail(401), true)).toBe('sign-in')
  })
  it('on a hosted instance: a refusal is no access, anything else a retry, never the made-up data', () => {
    expect(startFailure(fail(403), false)).toBe('no-access')
    expect(startFailure(fail(417, NO_PLACES), false)).toBe('no-access')
    expect(startFailure(fail(500), false)).toBe('try-again')
    expect(startFailure(new TypeError('Failed to fetch'), false)).toBe('try-again')
  })
  it('falls back to the made-up data only on a local instance', () => {
    expect(startFailure(fail(500), true)).toBe('made-up')
  })
})

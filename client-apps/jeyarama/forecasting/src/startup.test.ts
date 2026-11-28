import { describe, expect, it } from 'vitest'
import { hostedStart, signedIn } from './startup'
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

describe('who the signed-in person is to the app (28-Nov)', () => {
  const onChart = (name: string) => name === 'Made Up TL'
  it('lets someone who looks after the app see anyone', () => {
    expect(signedIn({ row_id: 'Administrator' }, onChart, true)).toBe('admin')
    expect(signedIn({ row_id: 'psn_1', roles: ['All', 'System Manager'] }, onChart, false)).toBe('admin')
  })
  it('opens the copy views for a real person on the read-only copies, never "not on the org chart"', () => {
    expect(signedIn({ row_id: 'psn_2', full_name: 'A Real Store Manager', roles: ['All', 'Dash Reader', 'Forecasting Member'] }, onChart, true)).toBe('copies')
  })
  it('keeps the made-up chart on the legacy Run: a person on it is theirs, anyone else is off it', () => {
    expect(signedIn({ row_id: 'psn_3', full_name: 'Made Up TL' }, onChart, false)).toBe('on-chart')
    expect(signedIn({ row_id: 'psn_4', full_name: 'Someone Else' }, onChart, false)).toBe('off-chart')
  })
})

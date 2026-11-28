// #1454: a person's places are asked once per request, and a provider failure is not remembered: the read fails, and
// the next check in the same request asks again. The provider here is a stand-in; every place is made up.
import { describe, expect, test, vi } from 'vitest'

const resolvePersonScope = vi.fn()
vi.mock('../src/person-scope', async (actual) => ({ ...(await actual<typeof import('../src/person-scope')>()), resolvePersonScope }))
vi.mock('../src/runtime-packages', () => ({ findScopeProvider: async () => ({ title: 'Stand-in roster' }) }))
const { placesOf, withPlacesMemo } = await import('../src/place-scope')

describe('a person’s places within one request', () => {
  test('a failure is passed on and not remembered; an answer is', async () => {
    resolvePersonScope.mockReset()
      .mockRejectedValueOnce(new Error('roster down'))
      .mockResolvedValueOnce([{ label: 'North', filters: { store: ['N1'] } }])
    await withPlacesMemo(async () => {
      await expect(placesOf('someone')).rejects.toThrow('roster down')
      expect(await placesOf('someone')).toEqual([{ label: 'North', filters: { store: ['N1'] } }])
      expect(await placesOf('someone')).toEqual([{ label: 'North', filters: { store: ['N1'] } }])
    })
    expect(resolvePersonScope).toHaveBeenCalledTimes(2)
  })
})

import { expect, it, vi } from 'vitest'

// #1224: a Table the viewer may not read names nobody, but a failure that is not a refusal (the database
// gone, a bug) must surface, never read as "names nobody". The scoped read is stood in for here.
vi.mock('../src/query', async (original) => ({
  ...(await original<typeof import('../src/query')>()),
  scopedWhere: async () => { throw new TypeError('connection lost') },
}))

it('an unexpected failure of the scoped read is not swallowed', async () => {
  const { actorNamesOn } = await import('../src/actor-names')
  await expect(actorNamesOn('psn_viewerviewerviewerv', 'Anything', ['psn_someonesomeonesomeo'])).rejects.toThrow('connection lost')
})

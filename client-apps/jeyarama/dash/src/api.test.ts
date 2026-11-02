// What the page asks the platform when the report refuses, played by a stand-in `fetch`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accessFacts } from './api'

const stub = (answers: Record<string, { status: number; body?: unknown }>) =>
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    const answer = answers[path] ?? { status: 404 }
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status })
  }))
const manager = { status: 200, body: { capabilities: { manage: true } } }

describe('accessFacts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a store reader is never asked about instance health', async () => {
    stub({ '/api/whoami': { status: 200, body: { capabilities: { manage: false } } } })
    expect(await accessFacts()).toEqual({ manages: false })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a manager is told what instance health says this app lacks', async () => {
    stub({ '/api/whoami': manager, '/api/instance-health': { status: 200, body: { checks: [
      { key: 'app-setup:other', missing: ['secret OTHER'] },
      { key: 'app-setup:feather_dash', missing: ['secret X'], fix: 'Set it.' }] } } })
    expect(await accessFacts()).toEqual({ manages: true, missing: ['secret X'], fix: 'Set it.' })
  })

  it('unreadable answers leave a reader, or a manager with nothing known to be missing', async () => {
    stub({})
    expect(await accessFacts()).toEqual({ manages: false })
    stub({ '/api/whoami': manager, '/api/instance-health': { status: 403 } })
    expect(await accessFacts()).toEqual({ manages: true, missing: undefined, fix: null })
  })
})

import { describe, expect, it } from 'vitest'
import { stateKeysIn } from './add-dive'

describe('stateKeysIn (#1225)', () => {
  it('finds each key a Dive reads, once, typed or not, in any quote', () => {
    const source = `const [store, setStore] = useDiveState<string>('store', '1501');
      const [reach] = useDiveState("reach", null)
      const [m] = useDiveState(\`month\`, 'this'); const [again] = useDiveState('store', '')`
    expect(stateKeysIn(source)).toEqual(['store', 'reach', 'month'])
  })
  it('finds none in a Dive that reads no state', () => {
    expect(stateKeysIn('export default function Dive() { return null }')).toEqual([])
  })
})

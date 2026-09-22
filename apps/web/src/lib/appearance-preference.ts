import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, getSessionUser } from './api'
import { useWhoAmI } from './session'

// The Admin owns one hook per preference. Each queue lives with that session's
// mounted Admin, so a queued selection never becomes a different user's write.
// @spec appearance_writes_settle_consistently
export function useAppearancePreference<T extends string>(
  key: 'theme' | 'palette',
  initial: T,
  isValue: (value: unknown) => value is T,
  apply: (value: T) => void,
) {
  const who = useWhoAmI()
  const qc = useQueryClient()
  const [value, setValue] = useState(initial)
  const intended = useRef(initial)
  const confirmed = useRef(initial)
  const queue = useRef(Promise.resolve())
  const version = useRef(0)
  const pending = useRef(0)
  const mounted = useRef(true)
  const user = getSessionUser()?.row_id
  const serverValue = who.data?.[key]

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!isValue(serverValue) || pending.current > 0) return
    confirmed.current = serverValue
    intended.current = serverValue
    setValue(serverValue)
    apply(serverValue)
  }, [serverValue, isValue, apply])

  function set(next: T | ((previous: T) => T)) {
    const choice = typeof next === 'function' ? next(intended.current) : next
    const revision = ++version.current
    intended.current = choice
    setValue(choice)
    apply(choice)
    pending.current++
    const active = () => mounted.current && getSessionUser()?.row_id === user
    queue.current = queue.current.then(async () => {
      try {
        if (!active()) return
        // A click can precede the first whoami response. Establish the real
        // rollback value before writing, rather than treating a mirror as an
        // acknowledgement or letting that initial read overwrite the choice.
        if (revision === 1) {
          const identity = await qc.ensureQueryData({
            queryKey: ['whoami'],
            queryFn: () => api.get<Record<string, unknown>>('/api/whoami'),
          })
          if (isValue(identity[key])) confirmed.current = identity[key]
        }
        if (!active()) return
        await api.post(`/api/set_${key}`, { [key]: choice })
        if (active()) confirmed.current = choice
      } catch {
        // Keep a newer intent visible; the final completion publishes the
        // last acknowledged value on either success or failure.
      } finally {
        pending.current--
        if (active() && revision === version.current) {
          const settled = confirmed.current
          intended.current = settled
          setValue(settled)
          apply(settled)
          qc.setQueryData(['whoami'], (old: unknown) =>
            old && typeof old === 'object' ? { ...old, [key]: settled } : old,
          )
        }
      }
    })
  }

  return { value, set }
}

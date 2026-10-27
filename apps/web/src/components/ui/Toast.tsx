import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from './cx'
import { CircleCheck, CircleX, Info, X } from './icons'

type ToastTone = 'info' | 'positive' | 'negative'
interface ToastItem {
  id: number
  tone: ToastTone
  message: ReactNode
}
type Show = (toast: { tone?: ToastTone; message: ReactNode }) => void

const ToastContext = createContext<Show | null>(null)

/** A confirmation leaves after this long; a failure stays until dismissed. */
export const TOAST_MS = 5000

const ICON = { info: Info, positive: CircleCheck, negative: CircleX }
const ICON_TONE = { info: 'text-ink-muted', positive: 'text-positive', negative: 'text-negative' }

/**
 * Short confirmations of what just happened. Mount once near the root; call
 * `useToast()` anywhere below it.
 *
 * The polite live region is rendered from the start and only its children
 * change, because screen readers announce changes inside a region they
 * already know about. A failure is its own alert and stays until dismissed.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const next = useRef(0)
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])
  const show = useCallback<Show>(({ tone = 'info', message }) => {
    const id = ++next.current
    setToasts((all) => [...all, { id, tone, message }])
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 sm:left-auto sm:w-96"
      >
        {toasts
          .filter((t) => t.tone === 'negative')
          .map((t) => (
            <ToastCard key={t.id} toast={t} dismiss={dismiss} />
          ))}
        <div role="status" aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
          {toasts
            .filter((t) => t.tone !== 'negative')
            .map((t) => (
              <ToastCard key={t.id} toast={t} dismiss={dismiss} />
            ))}
        </div>
      </section>
    </ToastContext.Provider>
  )
}

/**
 * One toast. A confirmation's countdown pauses while the pointer is on it or
 * focus is inside it, and resumes with the time it had left.
 */
function ToastCard({ toast, dismiss }: { toast: ToastItem; dismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const remaining = useRef(TOAST_MS)
  const paused = hovered || focused
  const { id, tone } = toast

  useEffect(() => {
    if (tone === 'negative' || paused) return
    const started = Date.now()
    const timer = setTimeout(() => dismiss(id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [id, tone, paused, dismiss])

  const Icon = ICON[tone]
  return (
    <div
      data-toast
      role={tone === 'negative' ? 'alert' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
      className="pointer-events-auto flex items-start gap-2.5 rounded-card border border-border bg-surface py-2 pl-3 pr-1 text-sm text-ink shadow-lg"
    >
      <Icon aria-hidden size={18} className={cx('mt-2.5 shrink-0', ICON_TONE[tone])} />
      <div className="min-w-0 flex-1 py-2">{toast.message}</div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(id)}
        className="inline-flex size-control shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
      >
        <X aria-hidden size={18} />
      </button>
    </div>
  )
}

export function useToast(): Show {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast needs a <ToastProvider> above it')
  return show
}

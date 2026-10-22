import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from './cx'
import { CircleCheck, CircleX, Info, X } from './icons'

export type ToastTone = 'info' | 'positive' | 'negative'
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
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </section>
    </ToastContext.Provider>
  )
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    if (toast.tone === 'negative') return
    const timer = setTimeout(onDismiss, TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast.tone, onDismiss])
  const Icon = ICON[toast.tone]
  return (
    <div
      role={toast.tone === 'negative' ? 'alert' : 'status'}
      className="pointer-events-auto flex items-start gap-2.5 rounded-card border border-border bg-surface py-2 pl-3 pr-1 text-sm text-ink shadow-lg"
    >
      <Icon aria-hidden size={18} className={cx('mt-2.5 shrink-0', ICON_TONE[toast.tone])} />
      <div className="min-w-0 flex-1 py-2">{toast.message}</div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
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

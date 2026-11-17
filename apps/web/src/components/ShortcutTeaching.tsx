import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { isQuiet, nextQuietStep, shortcutStatus } from 'shared'
import { X, buttonClasses, cx } from '@featherbase/shop-floor'
import {
  dismissTip,
  isTyping,
  quietTips,
  quietUntilText,
  resetTips,
  setShortcutsPanelOpen,
  turnTipsOn,
  useShortcutState,
  useShortcutTeaching,
  type ShownTip,
} from '../lib/shortcuts'
import { placeTip, type Box } from '../lib/tip-place'

// #1251: the keyboard-shortcut teaching, drawn by the top bar on every page:
// the "Keyboard ?" button, the Keyboard Shortcuts panel and its key badges,
// the tip or reminder, and the "tips are quiet" notice. Everything is fixed to
// the window, so it works the same inside the app bar's shadow root.

const kbdClasses = 'rounded-[5px] border border-b-2 border-border bg-surface px-1.5 font-mono text-[11px] text-ink-muted whitespace-nowrap'

/** Below the top bar this button sits in: where the panel, tip and notice start. */
function barBottom(anchor: RefObject<HTMLElement | null>): number {
  const bar = anchor.current?.closest('header')
  return bar ? bar.getBoundingClientRect().bottom : 52
}

export function ShortcutsButton() {
  useShortcutTeaching()
  const state = useShortcutState()
  const ref = useRef<HTMLButtonElement>(null)
  const open = useRef(state.panelOpen)
  open.current = state.panelOpen

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.composedPath()[0] ?? e.target)) return
      if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) {
        e.preventDefault()
        setShortcutsPanelOpen(!open.current)
      } else if (e.key === 'Escape' && open.current) setShortcutsPanelOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setShortcutsPanelOpen(!state.panelOpen)}
        aria-expanded={state.panelOpen}
        title="Keyboard Shortcuts · ?"
        data-shortcut-id="help"
        data-shortcut-key="?"
        data-testid="shortcuts-button"
        className={buttonClasses({ variant: 'quiet', className: 'gap-1.5 px-2 py-1 text-[13px] text-ink-muted' })}
      >
        Keyboard <kbd className={kbdClasses}>?</kbd>
      </button>
      {state.panelOpen && <ShortcutsPanel anchor={ref} />}
      {state.panelOpen && <KeyBadges anchor={ref} />}
      {state.tip && <Tip key={`${state.tip.id}-${state.tip.mouseUses}`} tip={state.tip} anchor={ref} />}
      {state.notice && (
        <div
          role="status"
          className="fixed left-1/2 z-[60] -translate-x-1/2 rounded-control bg-ink px-3.5 py-2 text-[13px] text-surface shadow-lg"
          style={{ top: barBottom(ref) + 12 }}
        >
          {state.notice}
        </div>
      )}
    </>
  )
}

function ShortcutsPanel({ anchor }: { anchor: RefObject<HTMLElement | null> }) {
  const { shortcuts, learning } = useShortcutState()
  const now = Date.now()
  const quiet = isQuiet(learning, now)
  const inUse = shortcuts.filter((s) => shortcutStatus(learning.use[s.id]).kind === 'in-use').length
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Keyboard Shortcuts"
      className="fixed right-4 z-[46] grid w-[340px] max-w-[calc(100vw-2rem)] gap-2 rounded-card border border-border bg-surface p-3 text-[13px] shadow-lg"
      style={{ top: barBottom(anchor) + 20 }}
      data-testid="shortcuts-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-ink">Keyboard Shortcuts</h2>
        <button type="button" aria-label="Close" title="Close · ?" onClick={() => setShortcutsPanelOpen(false)} className={buttonClasses({ variant: 'quiet', className: 'px-1.5 py-1 text-ink-muted' })}>
          <X aria-hidden size={16} />
        </button>
      </div>
      <p className="text-xs text-ink-subtle">While this is open, every control shows its key.</p>
      {shortcuts.map((s) => {
        const status = shortcutStatus(learning.use[s.id])
        const [tone, text] =
          status.kind === 'not-tried' ? ['text-ink-subtle', 'Not Tried Yet']
          : status.kind === 'in-use' ? ['text-positive', `In Use · ${status.keys}×`]
          : ['text-caution', `Slipping · Mouse ${status.mouse}× Since`]
        return (
          <div key={s.id} data-shortcut-row={s.id} className="grid grid-cols-[1fr_auto_120px] items-center gap-2 border-b border-border py-1">
            <span className="text-ink">{s.label}</span>
            <kbd className={kbdClasses}>{s.keys}</kbd>
            <span className={cx('text-right text-xs', tone)}>{text}</span>
          </div>
        )
      })}
      <div data-shortcut-row="help" className="grid grid-cols-[1fr_auto_120px] items-center gap-2 border-b border-border py-1">
        <span className="text-ink">Show This List</span>
        <kbd className={kbdClasses}>?</kbd>
        <span className="text-right text-xs text-positive">You Found It</span>
      </div>
      <p className="text-xs text-ink-subtle">{inUse} of {shortcuts.length} in use by keyboard.</p>
      {quiet && <p className="text-xs text-ink-subtle">Tips are quiet until {quietUntilText(learning)}.</p>}
      <div className="flex flex-wrap gap-2">
        {quiet ? (
          <button type="button" onClick={turnTipsOn} className={buttonClasses({ className: 'px-2.5 py-1 text-[13px]' })}>Turn Tips On Now</button>
        ) : (
          <button type="button" onClick={quietTips} className={buttonClasses({ className: 'px-2.5 py-1 text-[13px]' })}>Quiet Tips For {nextQuietStep(learning).label}</button>
        )}
        <button type="button" onClick={resetTips} className={buttonClasses({ variant: 'quiet', className: 'px-2.5 py-1 text-[13px]' })}>Reset Tips</button>
      </div>
    </aside>
  )
}

/** Every control on screen with a shortcut: in the document, in this bar's own
 *  root, and inside each app sidebar's (open) shadow root, where its Collapse
 *  control lives (#1248). */
function shortcutControls(anchor: RefObject<HTMLElement | null>): HTMLElement[] {
  const roots: ParentNode[] = [document]
  const root = anchor.current?.getRootNode()
  if (root instanceof ShadowRoot) roots.push(root)
  for (const sidebar of document.querySelectorAll('featherbase-sidebar')) if (sidebar.shadowRoot) roots.push(sidebar.shadowRoot)
  return roots.flatMap((r) => [...r.querySelectorAll<HTMLElement>('[data-shortcut-key]')])
    .filter((el) => (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility?.() !== false)
}

function KeyBadges({ anchor }: { anchor: RefObject<HTMLElement | null> }) {
  const [, redraw] = useState(0)
  useEffect(() => {
    const again = () => redraw((n) => n + 1)
    window.addEventListener('resize', again)
    window.addEventListener('scroll', again, true)
    return () => {
      window.removeEventListener('resize', again)
      window.removeEventListener('scroll', again, true)
    }
  }, [])
  return (
    <>
      {shortcutControls(anchor).map((el, i) => {
        const r = el.getBoundingClientRect()
        return (
          <span
            key={`${el.dataset.shortcutId}-${i}`}
            aria-hidden
            data-testid={`shortcut-badge-${el.dataset.shortcutId}`}
            className="pointer-events-none fixed z-[47] rounded bg-ink px-1 font-mono text-[10px] font-semibold leading-[14px] text-surface"
            style={{ top: r.top - 7, left: r.right - 5, transform: 'translateX(-100%)' }}
          >
            {el.dataset.shortcutKey}
          </span>
        )
      })}
    </>
  )
}

const INTERACTIVE = 'button, a[href], input, select, textarea, [role=tab], [role=button]'

function Tip({ tip, anchor }: { tip: ShownTip; anchor: RefObject<HTMLElement | null> }) {
  const { learning } = useShortcutState()
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const size = { width: el.offsetWidth, height: el.offsetHeight }
    const top = barBottom(anchor) + 8
    const avoid: Box[] = [...document.querySelectorAll<HTMLElement>(INTERACTIVE)]
      .filter((c) => !el.contains(c))
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.bottom > top && r.top < top + 4 * (size.height + 8))
    if (tip.near) avoid.push(tip.near)
    setAt(placeTip(size, avoid, { left: 16, right: window.innerWidth - 16, top }))
  }, [tip, anchor])
  const text = tip.reminder
    ? `You've done this by mouse ${tip.mouseUses} times since you last used ${tip.shortcut.keys}. ${tip.shortcut.tip}`
    : tip.shortcut.tip
  return (
    <div
      ref={ref}
      role="status"
      aria-label={tip.reminder ? 'Reminder' : 'Tip'}
      className={cx(
        'fixed z-[45] flex max-w-[560px] items-center gap-2 rounded-control border bg-surface py-1.5 pl-2.5 pr-1.5 text-[13px] text-ink shadow-lg',
        tip.reminder ? 'border-caution' : 'border-action',
      )}
      style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' }}
      data-testid="shortcut-tip"
    >
      <span className={cx('shrink-0 rounded-full px-2 text-[11px] font-semibold', tip.reminder ? 'bg-caution-tint text-caution' : 'bg-action-tint text-action')}>
        {tip.reminder ? 'Reminder' : 'Tip'}
      </span>
      <span>{text}</span>
      <button type="button" onClick={dismissTip} className={buttonClasses({ variant: 'quiet', className: 'shrink-0 px-2 py-1 text-[13px]' })}>Got It</button>
      <button type="button" onClick={quietTips} className={buttonClasses({ variant: 'quiet', className: 'shrink-0 px-2 py-1 text-[13px]' })}>Quiet Tips For {nextQuietStep(learning).label}</button>
    </div>
  )
}

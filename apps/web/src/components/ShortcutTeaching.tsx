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

// #1251: the keyboard-shortcut teaching. Since #1253 there is no top bar: the
// sidebar foot's Help menu opens the Keyboard Shortcuts panel, and an invisible
// host (rendered once by the bar beside the foot) loads the person's learning,
// listens for `?`, and draws the panel and its key badges, the tip or reminder,
// and the "tips are quiet" notice. All are fixed to the window and placed from
// the page's content area, so they work the same inside the bar's shadow root.

const kbdClasses = 'rounded-[5px] border border-b-2 border-border bg-surface px-1.5 font-mono text-xs text-ink-muted whitespace-nowrap'

/** Where the page itself sits: the Admin's <main> panel, else everything right
 *  of an app's sidebar. The panel, tip and notice are placed within it. */
export function contentArea(): { left: number; right: number; top: number } {
  const main = document.querySelector('main')
  if (main) {
    const r = main.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top }
  }
  const sidebar = document.querySelector('featherbase-sidebar')
  return { left: sidebar ? sidebar.getBoundingClientRect().right : 0, right: window.innerWidth, top: 0 }
}

/** The Help menu's first item (#1253's sidebar foot): opens the panel. */
export function KeyboardShortcutsItem({ className }: { className: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        // Close the Help menu the way it closes itself, then open the panel.
        e.currentTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
        setShortcutsPanelOpen(true)
      }}
      data-shortcut-id="help"
      data-shortcut-key="?"
      data-testid="keyboard-shortcuts-item"
      className={cx(className, 'flex items-center justify-between gap-3')}
    >
      <span>Keyboard Shortcuts</span>
      <kbd className={kbdClasses}>?</kbd>
    </button>
  )
}

export function ShortcutTeachingHost() {
  useShortcutTeaching()
  const state = useShortcutState()
  const ref = useRef<HTMLSpanElement>(null)
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
    <span ref={ref} hidden={!state.panelOpen && !state.tip && !state.notice} data-testid="shortcut-teaching">
      {state.panelOpen && <ShortcutsPanel />}
      {state.panelOpen && <KeyBadges anchor={ref} />}
      {state.tip && <Tip key={`${state.tip.id}-${state.tip.mouseUses}`} tip={state.tip} />}
      {state.notice && (
        <div
          role="status"
          className="fixed z-[60] -translate-x-1/2 rounded-control bg-ink px-3.5 py-2 text-[13px] text-surface shadow-lg"
          style={(({ left, right, top }) => ({ left: (left + right) / 2, top: top + 16 }))(contentArea())}
        >
          {state.notice}
        </div>
      )}
    </span>
  )
}

function ShortcutsPanel() {
  const { shortcuts, learning } = useShortcutState()
  const now = Date.now()
  const quiet = isQuiet(learning, now)
  const inUse = shortcuts.filter((s) => shortcutStatus(learning.use[s.id]).kind === 'in-use').length
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Keyboard Shortcuts"
      className="fixed z-[46] grid w-[340px] max-w-[calc(100vw-2rem)] gap-2 rounded-card border border-border bg-surface p-3 text-[13px] shadow-lg"
      style={(({ right, top }) => ({ top: top + 16, right: window.innerWidth - right + 16 }))(contentArea())}
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
          : ['text-caution', `Slipping · mouse ${status.mouse}× since`]
        return (
          <div key={s.id} data-shortcut-row={s.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-border py-1">
            <span className="text-ink">{s.label}</span>
            <kbd className={kbdClasses}>{s.keys}</kbd>
            <span className={cx('whitespace-nowrap text-right text-xs', tone)}>{text}</span>
          </div>
        )
      })}
      <div data-shortcut-row="help" className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-border py-1">
        <span className="text-ink">Show this list</span>
        <kbd className={kbdClasses}>?</kbd>
        <span className="whitespace-nowrap text-right text-xs text-positive">You found it</span>
      </div>
      <p className="text-xs text-ink-subtle">{inUse} of {shortcuts.length} in use by keyboard.</p>
      {quiet && <p className="text-xs text-ink-subtle">Tips are quiet until {quietUntilText(learning)}.</p>}
      <div className="flex flex-wrap gap-2">
        {quiet ? (
          <button type="button" onClick={turnTipsOn} className={buttonClasses({ className: 'px-2.5 py-1 text-[13px]' })}>Turn Tips On Now</button>
        ) : (
          <button type="button" onClick={quietTips} className={buttonClasses({ className: 'px-2.5 py-1 text-[13px]' })}>Quiet Tips For {nextQuietStep(learning).label}</button>
        )}
        <button type="button" onClick={resetTips} className={buttonClasses({ variant: 'quiet', className: 'px-2.5 py-1 text-[13px] text-ink' })}>Reset Tips</button>
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
    // A control that moves without a scroll or resize: the sidebar animating
    // to its rail (#1248), or a control changing size.
    document.addEventListener('transitionend', again, true)
    const sized = typeof ResizeObserver === 'function' ? new ResizeObserver(again) : null
    for (const el of shortcutControls(anchor)) sized?.observe(el)
    return () => {
      window.removeEventListener('resize', again)
      window.removeEventListener('scroll', again, true)
      document.removeEventListener('transitionend', again, true)
      sized?.disconnect()
    }
  }, [anchor])
  return (
    <>
      {shortcutControls(anchor).map((el, i) => {
        const r = el.getBoundingClientRect()
        return (
          <span
            key={`${el.dataset.shortcutId}-${i}`}
            aria-hidden
            data-testid={`shortcut-badge-${el.dataset.shortcutId}`}
            className="pointer-events-none fixed z-[47] rounded bg-ink px-1 font-mono text-xs font-semibold leading-4 text-surface"
            style={{ top: Math.max(2, r.top - 7), left: r.right - 5, transform: 'translateX(-100%)' }}
          >
            {el.dataset.shortcutKey}
          </span>
        )
      })}
    </>
  )
}

const INTERACTIVE = 'button, a[href], input, select, textarea, [role=tab], [role=button]'

function Tip({ tip }: { tip: ShownTip }) {
  const { learning } = useShortcutState()
  const ref = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current! // rendered: the effect runs after the tip is in the page
    const size = { width: el.offsetWidth, height: el.offsetHeight }
    const area = contentArea()
    const top = area.top + 16
    const avoid: Box[] = [...document.querySelectorAll<HTMLElement>(INTERACTIVE)]
      .filter((c) => !el.contains(c))
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.bottom > top && r.top < top + 4 * (size.height + 8))
    if (tip.near) avoid.push(tip.near)
    setAt(placeTip(size, avoid, { left: area.left + 16, right: area.right - 16, top }))
  }, [tip])
  const text = tip.reminder
    ? `You've done this by mouse ${tip.mouseUses} times since you last used ${tip.shortcut.keys}. ${tip.shortcut.tip}`
    : tip.shortcut.tip
  return (
    <div
      ref={ref}
      role="status"
      aria-label={tip.reminder ? 'Reminder' : 'Tip'}
      className={cx(
        'fixed z-[45] flex max-w-[760px] items-center gap-2 rounded-control border bg-surface py-1.5 pl-2.5 pr-1.5 text-[13px] text-ink shadow-lg',
        tip.reminder ? 'border-caution' : 'border-action',
      )}
      style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' }}
      data-testid="shortcut-tip"
    >
      <span className={cx('shrink-0 rounded-full px-2 text-xs font-semibold', tip.reminder ? 'bg-caution-tint text-caution' : 'bg-action-tint text-action')}>
        {tip.reminder ? 'Reminder' : 'Tip'}
      </span>
      <span>{text}</span>
      <button type="button" onClick={dismissTip} className={buttonClasses({ variant: 'quiet', className: 'shrink-0 px-2 py-1 text-[13px] text-ink' })}>Got It</button>
      <button type="button" onClick={quietTips} className={buttonClasses({ variant: 'quiet', className: 'shrink-0 px-2 py-1 text-[13px] text-ink' })}>Quiet Tips For {nextQuietStep(learning).label}</button>
    </div>
  )
}

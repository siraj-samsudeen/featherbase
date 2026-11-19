import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FEATHERBASE_ADMIN_DESTINATION, appHref, type AppTabIcon } from 'shared'
import { api } from '../lib/api'
import { useWhoAmI } from '../lib/session'
import { APP_ICON } from '../lib/app-icons'
import { Logo } from './Logo'
import { Check, ChevronDown, cx, iconButtonClasses, raisedClasses } from '@featherbase/shop-floor'
import { APP_ACCENT_ATTRIBUTE } from '@featherbase/shop-floor/theme'

/** Keep the server's cross-address sign-in handoff when leaving an app. */
export function useOpenAdmin() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  async function open() {
    setBusy(true)
    try {
      const to = await api.post<{ handoff?: string; landing?: string }>('/api/open_admin', {})
      if (to.handoff) window.location.assign(to.handoff)
      else await navigate({ to: to.landing ?? FEATHERBASE_ADMIN_DESTINATION.href })
    } catch {
      setBusy(false)
    }
  }
  return { open, busy }
}

interface CatalogApp {
  name: string
  title: string
  href: string
  /** #1236: what the app is for, in one line, its icon and its accent (its manifest's). */
  summary?: string
  icon?: AppTabIcon
  accent?: string
}

/** An app's icon on a tile in its own accent (ADR 0019), or the Featherbase mark. */
function AppMark({ icon, accent, admin = false }: { icon?: AppTabIcon; accent?: string; admin?: boolean }) {
  if (admin || !icon) return <Logo className="size-8 shrink-0" />
  const Icon = APP_ICON[icon]
  return (
    <span
      {...(accent ? { [APP_ACCENT_ATTRIBUTE]: accent } : {})}
      className="flex size-8 shrink-0 items-center justify-center rounded-control bg-action-tint text-action"
    >
      <Icon aria-hidden size={18} />
    </span>
  )
}

/**
 * #1236: the application switcher, one menu on platform and app pages. The
 * button shows the current app; its menu lists every app the person can open,
 * each with its icon and what it is for, the current one ticked, and ends with
 * Featherbase Admin for those who can open it. Only apps the person can open
 * are listed, for everyone (#1236 option A); who opens an app is on Admin → Apps.
 *
 * `compact`: on a phone, beside an app's pickers, the button shows only the
 * chevron (#983); the menu still opens and switches.
 */
export function AppSwitcher({ app, compact = false, place = 'bar' }: {
  app?: { name: string; title: string; href?: string }
  compact?: boolean
  /** #1253: in the sidebar the switcher is a plain row on the canvas; in the
   *  rail it is the logo alone, which still opens the list. */
  place?: 'bar' | 'sidebar' | 'rail'
}) {
  const whoami = useWhoAmI().data
  const catalog = useQuery({
    queryKey: ['app-catalog'],
    queryFn: () => api.get<CatalogApp[]>('/api/app_catalog'),
    enabled: Boolean(whoami),
  })
  const { open: openAdmin, busy } = useOpenAdmin()
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  // The catalog's address first (it may be another address's); else where the
  // page says the app lives (an interim page, a disabled app, the neutral name).
  const listed = catalog.data ?? []
  const entry = app?.name ? listed.find((item) => item.name === app.name) : undefined
  const current = app ? entry?.href || app.href || appHref(app.name) : FEATHERBASE_ADMIN_DESTINATION.href
  const name = app?.title ?? FEATHERBASE_ADMIN_DESTINATION.label
  const offersAdmin = !app || Boolean(whoami?.capabilities.admin)
  // The current entry is always one of the choices, listed or not.
  const choices: CatalogApp[] = app && !entry ? [{ name: app.name, title: app.title, href: current }, ...listed] : listed

  function choose(href: string) {
    setOpen(false)
    if (href === current) return
    if (app && href === FEATHERBASE_ADMIN_DESTINATION.href) void openAdmin()
    else window.location.assign(href)
  }

  const items = () => Array.from(wrapper.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])
  useEffect(() => {
    if (!open) return
    // The current app's row has the focus, as a native list would.
    const all = items()
    ;(all.find((item) => item.getAttribute('aria-checked') === 'true') ?? all[0])?.focus()
    function onDown(e: MouseEvent) {
      // The event's path: over an app's page the bar is in a shadow root (#650).
      if (wrapper.current && !e.composedPath().includes(wrapper.current)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const all = items()
    const at = all.indexOf(document.activeElement as HTMLElement)
    // Inside the bar's shadow root the document's active element is the host.
    const here = at >= 0 ? at : all.indexOf((wrapper.current?.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement)
    const move = (to: number) => { e.preventDefault(); all[(to + all.length) % all.length]?.focus() }
    if (e.key === 'ArrowDown') move(here + 1)
    else if (e.key === 'ArrowUp') move(here - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(all.length - 1)
    else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault()
      setOpen(false)
      if (e.key === 'Escape') button.current?.focus()
    }
  }

  const row = 'flex w-full items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none'
  return (
    <div className={cx('relative flex min-w-0 items-center', place === 'bar' ? 'gap-1' : 'gap-0.5')} ref={wrapper}>
      {place !== 'rail' && (
        <a href={current} aria-label={name} title={name} data-testid="top-bar-home" className={iconButtonClasses(cx('shrink-0 max-sm:min-h-11 max-sm:min-w-11', place === 'sidebar' && 'size-8 hover:bg-border/50'))}>
          <Logo className={place === 'sidebar' ? 'h-6 w-6' : 'h-7 w-7'} />
        </a>
      )}
      <button
        ref={button}
        type="button"
        aria-label={`Switch application: ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={busy}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true) }
        }}
        data-testid="top-bar-name"
        className={place === 'bar'
          ? cx(
              'flex min-h-control min-w-0 items-center gap-1.5 rounded-control border border-border-control bg-surface px-2.5 text-sm font-semibold text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus max-sm:min-h-11',
              compact ? 'max-sm:px-2' : '',
            )
          : place === 'sidebar'
            ? 'flex min-h-8 min-w-0 items-center gap-1 rounded-md px-1.5 text-sm font-semibold text-ink hover:bg-border/50 focus-visible:outline-2 focus-visible:outline-focus'
            : 'flex size-10 items-center justify-center rounded-md hover:bg-border/50 focus-visible:outline-2 focus-visible:outline-focus'}
      >
        {place === 'rail'
          ? <Logo className="h-7 w-7" />
          : <span className={cx('truncate', compact && 'max-sm:sr-only')}>{name}</span>}
        {place !== 'rail' && <ChevronDown aria-hidden size={place === 'sidebar' ? 14 : 16} className="shrink-0 text-ink-muted" />}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Applications"
          data-testid="app-switcher-menu"
          onKeyDown={onMenuKey}
          className={raisedClasses('absolute left-0 top-full z-40 mt-1 w-96 max-w-[calc(100vw-1rem)] p-1')}
        >
          {choices.map((item) => {
            const isCurrent = item.href === current
            return (
              <button
                key={item.name || item.href}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                tabIndex={-1}
                onClick={() => choose(item.href)}
                data-testid="app-switcher-item"
                data-app={item.name}
                data-title={item.title}
                className={row}
              >
                <AppMark icon={item.icon} accent={item.accent} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                  {item.summary && <span className="line-clamp-2 block text-[13px] text-ink-muted" title={item.summary}>{item.summary}</span>}
                </span>
                {isCurrent && <Check aria-hidden size={16} className="shrink-0 text-action" />}
              </button>
            )
          })}
          {offersAdmin && (
            <>
              {choices.length > 0 && <div role="separator" className="my-1 border-t border-border" />}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={current === FEATHERBASE_ADMIN_DESTINATION.href}
                tabIndex={-1}
                onClick={() => choose(FEATHERBASE_ADMIN_DESTINATION.href)}
                data-testid="app-switcher-item"
                data-app="featherbase-admin"
                data-title={FEATHERBASE_ADMIN_DESTINATION.label}
                className={row}
              >
                <AppMark admin />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{FEATHERBASE_ADMIN_DESTINATION.label}</span>
                  <span className="block truncate text-[13px] text-ink-muted">Tables, people and access</span>
                </span>
                {current === FEATHERBASE_ADMIN_DESTINATION.href && <Check aria-hidden size={16} className="shrink-0 text-action" />}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

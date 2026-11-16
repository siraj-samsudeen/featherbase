import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FEATHERBASE_ADMIN_DESTINATION, appHref } from 'shared'
import { api } from '../lib/api'
import { useWhoAmI } from '../lib/session'
import { Logo } from './Logo'
import { Select, iconButtonClasses } from '@featherbase/shop-floor'

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

/** #1008: why a System Manager can't open an installed app. */
const closedReason = (roles: string[]) =>
  roles.length ? `you need the ${roles.join(' or ')} role` : 'no role opens it yet'

/** The same native application-name dropdown on platform and app pages. */
/** `compact`: on a phone, only the logo and the list's chevron (#983), for an
 *  app whose pickers share the bar. The list still opens and switches. */
/** `app.href`: where the current entry leads when the catalog does not list
 *  it (#1227: an interim page, a disabled app, the neutral "Featherbase"). */
export function AppSwitcher({ app, compact = false }: { app?: { name: string; title: string; href?: string }; compact?: boolean }) {
  const whoami = useWhoAmI().data
  const catalog = useQuery({
    queryKey: ['app-catalog'],
    queryFn: () => api.get<{ name: string; title: string; href: string }[]>('/api/app_catalog'),
    enabled: Boolean(whoami),
  })
  const closed = useQuery({
    queryKey: ['app-catalog', 'closed'],
    queryFn: () => api.get<{ name: string; title: string; roles: string[] }[]>('/api/app_catalog/closed'),
    enabled: Boolean(whoami?.capabilities.manage),
  })
  const { open, busy } = useOpenAdmin()
  // The catalog's address first (it may be another address's); else where the
  // page says the app lives (an interim page, a disabled app, the neutral name).
  const current = app ? (app.name && catalog.data?.find((entry) => entry.name === app.name)?.href) || app.href || appHref(app.name) : FEATHERBASE_ADMIN_DESTINATION.href
  const name = app?.title ?? FEATHERBASE_ADMIN_DESTINATION.label
  const offersAdmin = !app || Boolean(whoami?.capabilities.admin)
  // The current entry is always one of the choices, listed or not (an interim
  // page, an app the list has not answered for yet, the neutral name).
  const listed = (offersAdmin && current === FEATHERBASE_ADMIN_DESTINATION.href) || Boolean(catalog.data?.some((entry) => entry.href === current))
  return <>
    <a href={current} aria-label={name} title={name} data-testid="top-bar-home" className={iconButtonClasses('shrink-0 max-sm:min-h-11 max-sm:min-w-11')}>
      <Logo className="h-7 w-7" />
    </a>
    <Select
      aria-label="Switch application"
      value={current}
      disabled={busy}
      onChange={(event) => {
        const href = event.target.value
        if (app && href === FEATHERBASE_ADMIN_DESTINATION.href) void open()
        else window.location.assign(href)
      }}
      wrapperClassName={compact ? 'max-sm:w-11 max-sm:flex-none min-w-0 sm:w-52 sm:flex-none md:w-auto md:flex-1' : 'min-w-0 flex-1 sm:w-52 sm:flex-none md:w-auto md:flex-1'}
      className={`truncate pl-2.5 pr-8 font-semibold max-sm:min-h-11 ${compact ? 'max-sm:pl-0 max-sm:pr-0 max-sm:text-transparent' : ''}`}
      data-testid="top-bar-name"
    >
      {!listed && <option className="text-ink" value={current}>{name}</option>}
      {offersAdmin && <option className="text-ink" value={FEATHERBASE_ADMIN_DESTINATION.href}>{FEATHERBASE_ADMIN_DESTINATION.label}</option>}
      {(catalog.data ?? []).map((entry) => <option className="text-ink" key={entry.name} value={entry.href}>{entry.title}</option>)}
      {(closed.data ?? []).map((entry) => <option className="text-ink-subtle" key={entry.name} value="" disabled>{entry.title}: {closedReason(entry.roles)}</option>)}
    </Select>
  </>
}

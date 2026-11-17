import { useQuery } from '@tanstack/react-query'
import { buttonClasses, ExternalLink } from '@featherbase/shop-floor'
import { api } from '../lib/api'
import { useWhoAmI } from '../lib/session'

/** The app catalog's entries this needs (the same query as the app switcher). */
interface CatalogApp {
  name: string
  title: string
  recordPages?: Record<string, string>
}

/** #1237: where the app that owns a Table shows one of its rows, when it has a
 *  page of its own for it and the person can open that app. */
export function useAppRecordPage(table: string, row: string): { app: string; href: string } | undefined {
  const whoami = useWhoAmI().data
  const catalog = useQuery({
    queryKey: ['app-catalog'],
    queryFn: () => api.get<CatalogApp[]>('/api/app_catalog'),
    enabled: Boolean(whoami),
  })
  for (const app of catalog.data ?? []) {
    const address = app.recordPages?.[table]
    if (address) return { app: app.title, href: address.replaceAll('{row}', encodeURIComponent(row)) }
  }
  return undefined
}

/** "Open in Tickets" at the top right of a record page whose app has its own
 *  readable view of the row (ticket-page item 17). It loads the app's page. */
export function OpenInApp({ table, row }: { table: string; row: string }) {
  const page = useAppRecordPage(table, row)
  if (!page) return null
  return (
    <a href={page.href} data-testid="open-in-app" className={buttonClasses({ className: 'gap-1.5' })}>
      Open in {page.app}
      <ExternalLink aria-hidden size={14} />
    </a>
  )
}

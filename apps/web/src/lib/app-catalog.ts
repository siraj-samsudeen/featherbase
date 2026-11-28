import type { AppTabLink, SidebarSection } from 'shared'
import { api } from './api'

/** #1385: what the app frame reads of each app the person can open: its tabs and its declared sidebar sections. */
export interface CatalogApp { name: string; title: string; href: string; tabs?: AppTabLink[]; sidebar?: SidebarSection[] }

/** The catalog, as the frame's queries under ['app-catalog'] read it. */
export function fetchAppCatalog(): Promise<CatalogApp[]> {
  return api.get<CatalogApp[]>('/api/app_catalog')
}

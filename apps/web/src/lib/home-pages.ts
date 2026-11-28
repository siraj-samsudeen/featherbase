import { useQuery } from '@tanstack/react-query'
import type { PageStatus } from 'shared'
import { api } from './api'

// #80: the caller's visible Home Pages, straight from GET /api/home_pages.
// Visibility (page roles) and link filtering (table read permission) are
// computed server-side — the client renders what it is given and nothing
// else. One query feeds both the sidebar and the page view.

export interface HomePageShortcut {
  label: string
  type?: string // table | report | dashboard | url
  link_to: string
  /** What the card says under its label; without it, the kind of place it opens. */
  description?: string
}

interface HomePageCard {
  label: string | null
  links: { label: string; link_to: string }[]
}

interface HomePage {
  row_id: string
  label: string
  icon: string | null
  module: string | null
  cards: HomePageCard[]
  shortcuts: HomePageShortcut[]
  /** #1410: the module's runtime pages this person may open; a Draft only for someone who may build. */
  pages: { name: string; title: string; status: PageStatus }[]
}

export function useHomePages() {
  return useQuery({
    queryKey: ['home-pages'],
    queryFn: () => api.get<{ pages: HomePage[] }>('/api/home_pages'),
  })
}

/**
 * #1340 (verifier round 4): the home page a Table's module crumb opens: the page that lists the Table, else its
 * module's page (as the sidebar marks it). None while they load or when there is none: the crumb opens Admin's home.
 */
export function useModuleHomePage(meta: { name: string; module?: string | null } | undefined): string | undefined {
  const pages = useHomePages().data?.pages ?? []
  if (!meta) return undefined
  return (pages.find((p) => p.cards.some((card) => card.links.some((link) => link.link_to === meta.name)))
    ?? pages.find((p) => p.module && p.module === meta.module))?.row_id
}

/**
 * #1410: a runtime page's title, by its name. The home pages list every page this person may open, each under
 * its module, and the sidebar has already asked for them. Undefined while they load, and for a page that is not
 * among them (deleted, or a Draft this person may not open).
 */
export function useSavedPageTitle(name: string | undefined): string | undefined {
  const pages = useHomePages().data?.pages ?? []
  return name === undefined ? undefined : pages.flatMap((home) => home.pages).find((page) => page.name === name)?.title
}

import { useQuery } from '@tanstack/react-query'
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

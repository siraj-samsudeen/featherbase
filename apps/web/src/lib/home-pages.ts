import { useQuery } from '@tanstack/react-query'
import { api } from './api'

// #80: the caller's visible Home Pages, straight from GET /api/home_pages.
// Visibility (page roles) and link filtering (table read permission) are
// computed server-side — the client renders what it is given and nothing
// else. One query feeds both the sidebar and the page view.

export interface HomePageShortcut {
  label: string
  type?: string // doctype | report | dashboard | url
  link_to: string
}

export interface HomePageCard {
  label: string | null
  links: { label: string; link_to: string }[]
}

export interface HomePage {
  name: string
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

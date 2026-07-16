import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { useWhoAmI } from './session'

// I18N-001: client translation. The user's language comes from whoami; the
// catalog (source → translated) is fetched for that language and `t(text)`
// looks strings up, falling back to the source. Chrome strings and field
// labels are wrapped in t() so any string with a catalog entry is translated.

export function useCatalog(language: string): Record<string, string> {
  const q = useQuery({
    queryKey: ['translations', language],
    queryFn: () => api.get<Record<string, string>>(`/api/translations/${encodeURIComponent(language)}`),
    enabled: Boolean(language) && language !== 'en',
    staleTime: 60_000,
  })
  return q.data ?? {}
}

export interface I18n {
  language: string
  t: (text: string) => string
  setLanguage: (lang: string) => void
}

export function useI18n(): I18n {
  const who = useWhoAmI()
  const qc = useQueryClient()
  const language = who.data?.language ?? 'en'
  const catalog = useCatalog(language)

  return {
    language,
    t: (text: string) => catalog[text] ?? text,
    setLanguage: (lang: string) => {
      void api.post('/api/set_language', { language: lang }).then(() => {
        qc.setQueryData(['whoami'], (old: unknown) =>
          old && typeof old === 'object' ? { ...(old as object), language: lang } : old,
        )
      })
    },
  }
}

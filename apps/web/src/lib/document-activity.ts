import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface DocumentComment {
  content: string
  created_by: string
  created_at: string
}

export interface DocumentVersion {
  created_by: string
  created_at: string
  data: { changed?: [string, unknown, unknown][] } | null
}

export interface DocumentActivity {
  comments: DocumentComment[]
  versions: DocumentVersion[]
}

export const documentActivityKey = (table: string, name: string) =>
  ['document-activity', table, name] as const

export function useDocumentActivity(table: string, name: string) {
  return useQuery({
    queryKey: documentActivityKey(table, name),
    queryFn: () =>
      api.get<DocumentActivity>(
        `/api/activity/${encodeURIComponent(table)}/${encodeURIComponent(name)}`,
      ),
  })
}

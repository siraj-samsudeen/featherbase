import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, listResource } from '../lib/api'

interface FileRow {
  row_id: string
  file_name: string
  file_url: string
  is_private: boolean
  // FILE-004: an inline data-URI thumbnail for image uploads (else null).
  thumbnail_url?: string | null
}

// FILE-002: attachments panel — File rows linked to this row via
// ref_table/ref_name. Upload goes through /api/upload_file; deleting the
// File row also removes the storage object (server on_trash hook).
export function Attachments({ table, name }: { table: string; name: string }) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const files = useQuery({
    queryKey: ['attachments', table, name],
    queryFn: () =>
      listResource<FileRow>('File', {
        filters: [
          ['ref_table', '=', table],
          ['ref_name', '=', name],
        ],
        fields: ['row_id', 'file_name', 'file_url', 'is_private', 'thumbnail_url'],
        order_by: 'created_at asc',
        limit_page_length: 100,
      }),
  })

  async function upload(file: globalThis.File) {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('ref_table', table)
      form.append('ref_name', name)
      await api.upload(form)
      await queryClient.invalidateQueries({ queryKey: ['attachments', table, name] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove(fileDoc: string) {
    setError(null)
    try {
      await api.delete(`/api/table/File/${encodeURIComponent(fileDoc)}`)
      await queryClient.invalidateQueries({ queryKey: ['attachments', table, name] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    }
  }

  // #173: private files carry no credential in the URL. The link is
  // same-origin, so the HttpOnly `sid` cookie authenticates it.
  const href = (f: FileRow) => f.file_url

  return (
    <div className="fc-card min-w-0 p-4 [overflow-wrap:anywhere]" data-testid="attachments-panel">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
          Attachments
        </span>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          data-testid="attach-file"
          className="text-xs font-medium text-[var(--color-brand)] hover:underline disabled:opacity-40"
        >
          {busy ? 'Uploading…' : '+ Attach'}
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          data-testid="attach-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) upload(f)
          }}
        />
      </div>
      {error && (
        <p className="mb-2 text-xs text-[var(--color-danger)]" data-testid="attach-error">
          {error}
        </p>
      )}
      {files.data?.data.length === 0 && (
        <p className="text-xs text-[var(--color-ink-faint)]">No attachments</p>
      )}
      <ul className="space-y-1">
        {files.data?.data.map((f) => (
          <li
            key={f.row_id}
            className="flex items-center justify-between gap-2 text-sm"
            data-testid="attachment-row"
          >
            <a
              href={href(f)}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-2 text-[var(--color-brand)] hover:underline"
            >
              {f.thumbnail_url ? (
                <img
                  src={f.thumbnail_url}
                  alt=""
                  data-testid="attachment-thumb"
                  className="h-8 w-8 shrink-0 rounded border border-[var(--color-border)] object-cover"
                />
              ) : null}
              <span className="min-w-0">{f.file_name}</span>
            </a>
            <button
              aria-label={`Remove ${f.file_name}`}
              onClick={() => remove(f.row_id)}
              data-testid="attachment-delete"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--color-ink-muted)] hover:text-[var(--color-danger)] focus-visible:outline-2 focus-visible:outline-[var(--color-brand)]"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

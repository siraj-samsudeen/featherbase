import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, getToken, listResource } from '../lib/api'

interface FileRow {
  name: string
  file_name: string
  file_url: string
  is_private: boolean
}

// FILE-002: attachments panel — File docs linked to this document via
// ref_doctype/ref_name. Upload goes through /api/upload_file; deleting the
// File doc also removes the storage object (server on_trash hook).
export function Attachments({ doctype, name }: { doctype: string; name: string }) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const files = useQuery({
    queryKey: ['attachments', doctype, name],
    queryFn: () =>
      listResource<FileRow>('File', {
        filters: [
          ['ref_doctype', '=', doctype],
          ['ref_name', '=', name],
        ],
        fields: ['name', 'file_name', 'file_url', 'is_private'],
        order_by: 'creation asc',
        limit_page_length: 100,
      }),
  })

  async function upload(file: globalThis.File) {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('ref_doctype', doctype)
      form.append('ref_name', name)
      const res = await fetch('/api/upload_file', {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken()}` },
        body: form,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(body.error?.message ?? `Upload failed (${res.status})`)
      }
      await queryClient.invalidateQueries({ queryKey: ['attachments', doctype, name] })
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
      await api.delete(`/api/resource/File/${encodeURIComponent(fileDoc)}`)
      await queryClient.invalidateQueries({ queryKey: ['attachments', doctype, name] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed')
    }
  }

  const href = (f: FileRow) =>
    f.is_private ? `${f.file_url}?token=${getToken()}` : f.file_url

  return (
    <div className="fc-card p-4" data-testid="attachments-panel">
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
            key={f.name}
            className="group flex items-center justify-between gap-2 text-sm"
            data-testid="attachment-row"
          >
            <a
              href={href(f)}
              target="_blank"
              rel="noreferrer"
              className="truncate text-[var(--color-brand)] hover:underline"
            >
              {f.file_name}
            </a>
            <button
              aria-label={`Remove ${f.file_name}`}
              onClick={() => remove(f.name)}
              data-testid="attachment-delete"
              className="text-[var(--color-ink-faint)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--color-danger)]"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

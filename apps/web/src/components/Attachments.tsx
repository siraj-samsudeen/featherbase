import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, listResource } from '../lib/api'
import { useCanReadTable } from '../lib/session'
import { useRowCapabilities } from '../lib/row-capabilities'
import { cardClasses, iconButtonClasses, touchLinkClasses, touchRowClasses } from '@featherbase/shop-floor'

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
export function Attachments({ table, name, readOnly, canUpload }: { table: string; name: string; readOnly: boolean; canUpload: boolean }) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // #861: only ask for File rows when this person's role may read them.
  const canRead = useCanReadTable('File')
  const files = useQuery({
    enabled: canRead === true,
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

  // Nothing to show to someone who can neither read the files nor attach one.
  if (canRead === false && (readOnly || !canUpload)) return null
  if (readOnly && files.data?.data.length === 0) return null

  return (
    <div className={cardClasses('min-w-0 p-4 [overflow-wrap:anywhere]')} data-testid="attachments-panel">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-subtle">
          Attachments
        </span>
        {!readOnly && canUpload && <><button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          data-testid="attach-file"
          className={touchLinkClasses('text-xs font-medium text-action hover:underline disabled:opacity-40')}
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
        /></>}
      </div>
      {files.isError && <p role="alert" className="text-sm text-negative">Attachments could not be read.</p>}
      {error && (
        <p className="mb-2 text-xs text-negative" data-testid="attach-error">
          {error}
        </p>
      )}
      {files.data?.data.length === 0 && (
        <p className="text-xs text-ink-subtle">No attachments</p>
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
              className={touchRowClasses("flex min-w-0 items-center gap-2 text-action hover:underline")}
            >
              {f.thumbnail_url ? (
                <img
                  src={f.thumbnail_url}
                  alt=""
                  data-testid="attachment-thumb"
                  className="h-8 w-8 shrink-0 rounded border border-border object-cover"
                />
              ) : null}
              <span className="min-w-0">{f.file_name}</span>
            </a>
            {!readOnly && <RemoveAttachment file={f} remove={remove} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

// File deletion has its own row ownership grant, independent of upload or
// parent-row write permission. Never infer it from either of those controls.
function RemoveAttachment({ file, remove }: { file: FileRow; remove: (name: string) => Promise<void> }) {
  const access = useRowCapabilities('File', file.row_id)
  if (!access.data?.delete) return null
  return <button
    aria-label={`Remove ${file.file_name}`}
    onClick={() => remove(file.row_id)}
    data-testid="attachment-delete"
    className={iconButtonClasses('hover:text-negative')}
  >×</button>
}

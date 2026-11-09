import { useRef, useState } from 'react'
import { api } from '../lib/api'
import type { ColumnDef } from '../lib/meta'
import { useI18n } from '../lib/i18n'
import { buttonClasses, touchLinkClasses } from '@featherbase/shop-floor'

// UI-023: Attach / Attach Image — upload a file, store its URL as the field
// value, preview images, and allow clearing. The doc still has to be saved
// for the value to persist, like any other field edit.
export function AttachControl({
  field,
  value,
  onChange,
  common,
  refTable,
  refName,
}: {
  field: ColumnDef
  value: unknown
  onChange: (value: unknown) => void
  common: Record<string, unknown>
  refTable: string
  refName?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const { t } = useI18n()
  const fieldLabel = t(field.label ?? field.column_name)
  const isImage = field.column_type === 'Attach Image'
  // #173: a private file URL carries no credential — the <img>/<a> request is
  // same-origin, so the HttpOnly `sid` cookie authenticates it.
  const url = typeof value === 'string' && value ? value : null

  async function upload(file: globalThis.File) {
    setBusy(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('ref_table', refTable)
      if (refName) form.append('ref_name', refName)
      const body = await api.upload<{ file_url: string }>(form)
      onChange(body.file_url)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div data-field={field.column_name} data-fieldtype={field.column_type}>
      <input
        {...common}
        ref={inputRef}
        type="file"
        accept={isImage ? 'image/*' : undefined}
        className="hidden"
        data-attach-input={field.column_name}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(f)
        }}
      />
      {url ? (
        <div>
          {isImage && (
            <img
              src={url}
              alt={field.label ?? field.column_name}
              data-testid={`attach-preview-${field.column_name}`}
              className="mb-2 max-h-40 rounded-md border border-border"
            />
          )}
          <div className="flex items-center gap-2 text-sm">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className={touchLinkClasses("min-w-0 text-action hover:underline")}
              data-testid={`attach-link-${field.column_name}`}
            >
              {url.split('/').pop()?.replace(/^[0-9a-f]{16}_/, '')}
            </a>
            {!field.read_only && (
              <button
                type="button"
                aria-label={`Clear ${fieldLabel}`}
                onClick={() => onChange(null)}
                data-testid={`attach-clear-${field.column_name}`}
                className={touchLinkClasses("shrink-0 text-xs text-ink-subtle hover:text-negative")}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          aria-label={`${busy ? 'Uploading' : `Attach ${isImage ? 'image' : 'file'}`} — ${fieldLabel}`}
          onClick={() => inputRef.current?.click()}
          disabled={Boolean(field.read_only) || busy}
          data-testid={`attach-btn-${field.column_name}`}
          className={buttonClasses({ className: 'text-sm' })}
        >
          {busy ? 'Uploading…' : `Attach ${isImage ? 'image' : 'file'}`}
        </button>
      )}
      {uploadError && (
        <p className="mt-1 text-xs text-negative">{uploadError}</p>
      )}
    </div>
  )
}

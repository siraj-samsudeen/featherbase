import { excelRow, isBlankRow, type ParsedSheet } from '../lib/parse-file'

// Named import threshold (packages/shared/src/import.ts): preview cap — enough to spot trouble, cheap to render. Failed
// rows beyond the cap always render.
const PREVIEW_ROWS = 50

/** A sheet cell as the preview shows it: a date as its calendar day (#387), never via toISOString(). */
export function previewCell(v: unknown): string {
  if (v == null) return ''
  return String(v)
}

// The sheet itself, numbered like Excel — through the same excelRow
// translation the error messages use, so the preview and the failures
// CANNOT disagree (#115). Blank rows render as gaps rather than vanishing;
// failed rows are highlighted in place with their message. Collapsed until
// a check or import reports problems.
export function SheetPreview({
  i,
  sheet,
  failed,
  label,
}: {
  i: number | string
  sheet: ParsedSheet
  failed: { sourceIndex: number; message: string }[] | null
  // #201: which member sheet this preview is of, when the target is a merge
  // group. Null for an ordinary single-sheet target.
  label?: string | null
}) {
  const byRow = new Map((failed ?? []).map((f) => [f.sourceIndex, f.message]))
  const rows = sheet.rows.map((cells, si) => ({ cells, si }))
  const head = rows.slice(0, PREVIEW_ROWS)
  const tailFailed = rows.slice(PREVIEW_ROWS).filter((r) => byRow.has(r.si))
  const hidden = rows.length - head.length - tailFailed.length
  const problemCol = byRow.size > 0

  function previewRow({ cells, si }: { cells: unknown[]; si: number }) {
    const message = byRow.get(si)
    const blank = isBlankRow(cells)
    return (
      <tr
        key={si}
        data-testid={`iw-preview-row-${i}-${excelRow(si, sheet.headerExcelRow)}`}
        data-failed={message ? 'true' : undefined}
        className={message ? 'bg-negative-tint' : blank ? 'text-ink-subtle' : undefined}
      >
        <td className="px-2 py-0.5 text-right text-ink-subtle">
          {excelRow(si, sheet.headerExcelRow)}
        </td>
        {sheet.headers.map((_, c) => (
          <td key={c} className="whitespace-nowrap px-2 py-0.5">
            {blank ? (c === 0 ? '—' : '') : previewCell(cells[c])}
          </td>
        ))}
        {problemCol && <td className="px-2 py-0.5 text-negative">{message ?? ''}</td>}
      </tr>
    )
  }

  return (
    <details className="mt-2" data-testid={`iw-sheet-preview-${i}`} open={problemCol}>
      <summary className="cursor-pointer text-xs text-ink-muted">
        {label ? `Preview "${label}"` : 'Preview'} — row numbers match your spreadsheet
      </summary>
      <div className="mt-1 max-h-64 overflow-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-subtle text-left text-ink-muted">
            <tr>
              {/* The header's own Excel row number sits in the corner. */}
              <th className="w-10 px-2 py-1 text-right font-normal text-ink-subtle">
                {sheet.headerExcelRow}
              </th>
              {sheet.headers.map((h, c) => (
                <th key={c} className="px-2 py-1 font-medium">
                  {h}
                </th>
              ))}
              {problemCol && <th className="px-2 py-1 font-medium text-negative">Problem</th>}
            </tr>
          </thead>
          <tbody>
            {head.map(previewRow)}
            {hidden > 0 && (
              <tr data-testid={`iw-preview-gap-${i}`}>
                <td
                  colSpan={sheet.headers.length + (problemCol ? 2 : 1)}
                  className="px-2 py-1 text-ink-subtle"
                >
                  … {hidden} more rows
                </td>
              </tr>
            )}
            {tailFailed.map(previewRow)}
          </tbody>
        </table>
      </div>
    </details>
  )
}

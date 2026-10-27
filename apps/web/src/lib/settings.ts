import { useQuery } from '@tanstack/react-query'
import { DISPLAY_DEFAULTS } from 'shared'
import { api } from './api'
import { fmtCurrency, fmtDate, fmtDateTime, fmtNumber } from './inr'

// SET-004: global display settings drive how Date and Currency/Float values
// render across every list and form. Fetched once and cached; the Admin reads
// it through useSettings().

export interface Settings {
  app_name: string
  // 'dd-mon-yyyy' is the one display form (ADR 844); ISO stays machine-facing only.
  date_format: string
  currency: string
  currency_precision: number
  float_precision: number
}

// The same defaults /api/settings falls back to (packages/shared display-settings).
export const DEFAULT_SETTINGS: Settings = { ...DISPLAY_DEFAULTS }

export function useSettings() {
  const q = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Settings>('/api/settings'),
    staleTime: 30_000,
  })
  return q.data ?? DEFAULT_SETTINGS
}

// Reformat an ISO date (YYYY-MM-DD, or a Date column's UTC-midnight timestamp)
// for display as DD-Mon-YYYY. Reads the leading date parts directly, so the
// rendered day never drifts across timezones. `fmt` is the System Settings value; there
// is one display form today.
export function formatDate(value: unknown, _fmt: string): string {
  if (value == null || value === '') return ''
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? fmtDate(m[1]) : String(value)
}

// A Datetime is an instant: read it on the viewer's own clock, with its time,
// so an IST 02:00 is not shown as the previous UTC day (#390).
export function formatDateTime(value: unknown): string {
  if (value == null || value === '') return ''
  const d = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(d.getTime()) ? String(value) : fmtDateTime(d)
}

export function formatNumber(value: unknown, precision: number): string {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return fmtNumber(n, precision)
}

export function formatCurrency(value: unknown, s: Settings): string {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return fmtCurrency(n, s.currency_precision, s.currency)
}

// Column-type-aware display formatting used by list cells and read-only
// previews. Anything without special handling falls back to a plain string.
export function formatValue(columnType: string, value: unknown, s: Settings): string {
  if (value == null || value === '') return ''
  switch (columnType) {
    case 'Date':
      return formatDate(value, s.date_format)
    case 'Datetime':
      return formatDateTime(value)
    case 'Currency':
      return formatCurrency(value, s)
    case 'Float':
      return formatNumber(value, s.float_precision)
    case 'Check':
      return value ? '✓' : '✗'
    default:
      return String(value)
  }
}

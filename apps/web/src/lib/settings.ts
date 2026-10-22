import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { fmtDate, fmtMoney, fmtNumber } from './inr'

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

export const DEFAULT_SETTINGS: Settings = {
  app_name: 'Featherbase',
  date_format: 'dd-mon-yyyy',
  currency: 'INR',
  currency_precision: 2,
  float_precision: 2,
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥',
}

export function useSettings() {
  const q = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Settings>('/api/settings'),
    staleTime: 30_000,
  })
  return q.data ?? DEFAULT_SETTINGS
}

// Reformat an ISO date (YYYY-MM-DD or a full ISO timestamp) for display as
// DD-Mon-YYYY. Reads the leading date parts directly, so the rendered day
// never drifts across timezones. `fmt` is the System Settings value; there
// is one display form today.
export function formatDate(value: unknown, _fmt: string): string {
  if (value == null || value === '') return ''
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? fmtDate(m[1]) : String(value)
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
  const num = fmtMoney(n, s.currency_precision, s.currency)
  const symbol = CURRENCY_SYMBOLS[s.currency] ?? ''
  return `${symbol}${num}`
}

// Column-type-aware display formatting used by list cells and read-only
// previews. Anything without special handling falls back to a plain string.
export function formatValue(columnType: string, value: unknown, s: Settings): string {
  if (value == null || value === '') return ''
  switch (columnType) {
    case 'Date':
    case 'Datetime':
      return formatDate(value, s.date_format)
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

import { useQuery } from '@tanstack/react-query'
import { api } from './api'

// SET-004: global display settings drive how Date and Currency/Float values
// render across every list and form. Fetched once and cached; the Desk reads
// it through useSettings().

export interface Settings {
  app_name: string
  date_format: string // 'yyyy-mm-dd' | 'dd-mm-yyyy' | 'mm-dd-yyyy'
  currency: string
  currency_precision: number
  float_precision: number
}

export const DEFAULT_SETTINGS: Settings = {
  app_name: 'Frappe Clone',
  date_format: 'yyyy-mm-dd',
  currency: 'USD',
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

// Reformat an ISO date (YYYY-MM-DD or a full ISO timestamp) into the
// configured display format. Parses the leading date parts directly so the
// rendered day never drifts across timezones.
export function formatDate(value: unknown, fmt: string): string {
  if (value == null || value === '') return ''
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(value)
  const [, yyyy, mm, dd] = m
  switch (fmt) {
    case 'dd-mm-yyyy': return `${dd}-${mm}-${yyyy}`
    case 'mm-dd-yyyy': return `${mm}-${dd}-${yyyy}`
    default: return `${yyyy}-${mm}-${dd}`
  }
}

export function formatNumber(value: unknown, precision: number): string {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  return n.toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })
}

export function formatCurrency(value: unknown, s: Settings): string {
  const num = formatNumber(value, s.currency_precision)
  if (num === '') return ''
  const symbol = CURRENCY_SYMBOLS[s.currency] ?? ''
  return `${symbol}${num}`
}

// Field-type-aware display formatting used by list cells and read-only
// previews. Anything without special handling falls back to a plain string.
export function formatValue(fieldtype: string, value: unknown, s: Settings): string {
  if (value == null || value === '') return ''
  switch (fieldtype) {
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

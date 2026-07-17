// SET-004: global System Settings that drive rendering and session lifetime.
// Values live in the `single_value` EAV store (SET-001); unset fields fall
// back to these defaults, which mirror the seeded docfield defaults.
import { sql } from './db'

export interface SystemSettings {
  app_name: string
  time_zone: string
  date_format: string
  session_hours: number
  currency: string
  currency_precision: number
  float_precision: number
}

const DEFAULTS: SystemSettings = {
  app_name: 'Frappe Clone',
  time_zone: 'UTC',
  date_format: 'yyyy-mm-dd',
  session_hours: 8,
  currency: 'USD',
  currency_precision: 2,
  float_precision: 2,
}

export async function getSystemSettings(): Promise<SystemSettings> {
  const rows = await sql`select field, value from single_value where doctype = 'System Settings'`
  const stored = new Map(rows.map((r) => [r.field as string, r.value as string | null]))
  const str = (f: keyof SystemSettings) => {
    const v = stored.get(f)
    return v == null || v === '' ? (DEFAULTS[f] as string) : v
  }
  const num = (f: keyof SystemSettings) => {
    const v = stored.get(f)
    const n = v == null || v === '' ? NaN : Number(v)
    return Number.isFinite(n) ? n : (DEFAULTS[f] as number)
  }
  return {
    app_name: str('app_name'),
    time_zone: str('time_zone'),
    date_format: str('date_format'),
    session_hours: num('session_hours'),
    currency: str('currency'),
    currency_precision: num('currency_precision'),
    float_precision: num('float_precision'),
  }
}

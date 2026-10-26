import { useQuery } from '@tanstack/react-query'
import { listResource } from './api'

// CUST-003: Client Scripts. Enabled scripts for a Table are fetched and
// evaluated in the browser. Each script registers form-event handlers via a
// minimal `featherbase.ui.form.on(table, handlers)` API (its shape, and the
// `frm` handle's get_value/set_value, were first modelled on Frappe's form
// scripts). The FormView calls the matching handler on onload / field change /
// before_save.
// A script error is caught and reported — it never crashes the Admin.

export interface Frm {
  doc: Record<string, unknown>
  get_value: (field: string) => unknown
  set_value: (field: string, value: unknown) => void
}

type Handler = (frm: Frm) => void
// fieldname → handler, plus the special 'onload' / 'before_save' keys.
type HandlerMap = Record<string, Handler>

interface CompiledScripts {
  handlers: HandlerMap
  errors: string[]
}

// Build the `featherbase` API a script sees and evaluate every script against it.
function compileClientScripts(table: string, scripts: string[]): CompiledScripts {
  const handlers: HandlerMap = {}
  const errors: string[] = []

  const featherbase = {
    ui: {
      form: {
        on(dt: string, map: HandlerMap) {
          if (dt !== table) return
          for (const [key, fn] of Object.entries(map)) {
            if (typeof fn === 'function') handlers[key] = fn
          }
        },
      },
    },
  }

  for (const src of scripts) {
    try {
      // Scripts are trusted author input, run with `featherbase` in scope.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function('featherbase', src)
      fn(featherbase)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  return { handlers, errors }
}

export function useClientScripts(table: string): CompiledScripts {
  const q = useQuery({
    queryKey: ['client-scripts', table],
    queryFn: () =>
      listResource<{ name: string; script: string }>('Client Script', {
        filters: [
          ['ref_table', '=', table],
          ['enabled', '=', true],
        ],
        fields: ['row_id', 'script'],
        limit_page_length: 50,
      }),
    staleTime: 30_000,
  })
  const scripts = (q.data?.data ?? []).map((r) => r.script).filter(Boolean)
  return compileClientScripts(table, scripts)
}

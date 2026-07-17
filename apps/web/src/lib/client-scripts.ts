import { useQuery } from '@tanstack/react-query'
import { listResource } from './api'

// CUST-003: Client Scripts. Enabled scripts for a DocType are fetched and
// evaluated in the browser. Each script registers form-event handlers via a
// minimal `frappe.ui.form.on(doctype, handlers)` API. The FormView calls the
// matching handler on onload / field change / before_save. A script error is
// caught and reported — it never crashes the Desk.

export interface Frm {
  doc: Record<string, unknown>
  get_value: (field: string) => unknown
  set_value: (field: string, value: unknown) => void
}

export type Handler = (frm: Frm) => void
// fieldname → handler, plus the special 'onload' / 'before_save' keys.
export type HandlerMap = Record<string, Handler>

export interface CompiledScripts {
  handlers: HandlerMap
  errors: string[]
}

// Build the `frappe` API a script sees and evaluate every script against it.
export function compileClientScripts(doctype: string, scripts: string[]): CompiledScripts {
  const handlers: HandlerMap = {}
  const errors: string[] = []

  const frappe = {
    ui: {
      form: {
        on(dt: string, map: HandlerMap) {
          if (dt !== doctype) return
          for (const [key, fn] of Object.entries(map)) {
            if (typeof fn === 'function') handlers[key] = fn
          }
        },
      },
    },
  }

  for (const src of scripts) {
    try {
      // Scripts are trusted author input, run with `frappe` in scope.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function('frappe', src)
      fn(frappe)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  return { handlers, errors }
}

export function useClientScripts(doctype: string): CompiledScripts {
  const q = useQuery({
    queryKey: ['client-scripts', doctype],
    queryFn: () =>
      listResource<{ name: string; script: string }>('Client Script', {
        filters: [
          ['reference_doctype', '=', doctype],
          ['enabled', '=', true],
        ],
        fields: ['name', 'script'],
        limit_page_length: 50,
      }),
    staleTime: 30_000,
  })
  const scripts = (q.data?.data ?? []).map((r) => r.script).filter(Boolean)
  return compileClientScripts(doctype, scripts)
}

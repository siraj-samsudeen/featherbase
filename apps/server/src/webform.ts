import { sql } from './db'
import { AppError } from './errors'
import { getMeta } from './meta'
import { saveDoc } from './document'

// WEB-002: public web forms. A published Web Form exposes a whitelist of a
// target DocType's fields; an (anonymous) submit creates a document of that
// type through the normal save lifecycle, so server validation still applies.
// Only whitelisted fields are accepted, and only for the configured DocType.

export interface WebFormField {
  fieldname: string
  label: string
  fieldtype: string
  options: string | null
  reqd: boolean
}

export interface WebFormConfig {
  route: string
  title: string
  document_type: string
  success_message: string
  fields: WebFormField[]
}

async function loadForm(route: string) {
  const [form] = await sql`
    select name, title, route, document_type, web_fields, published, success_message
    from tab_web_form where route = ${route}`
  if (!form || !form.published)
    throw new AppError('NotFoundError', `No published web form at ${route}`)
  return form
}

function fieldnames(webFields: unknown): string[] {
  if (Array.isArray(webFields)) return webFields.map(String)
  if (typeof webFields === 'string' && webFields.trim()) {
    try {
      const parsed = JSON.parse(webFields)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

export async function getWebFormConfig(route: string): Promise<WebFormConfig> {
  const form = await loadForm(route)
  const meta = await getMeta(form.document_type as string)
  const wanted = new Set(fieldnames(form.web_fields))
  const fields: WebFormField[] = meta.fields
    .filter((f) => wanted.has(f.fieldname))
    .map((f) => ({
      fieldname: f.fieldname,
      label: f.label ?? f.fieldname,
      fieldtype: f.fieldtype,
      options: f.options ?? null,
      reqd: Boolean(f.reqd),
    }))
  return {
    route: form.route as string,
    title: form.title as string,
    document_type: form.document_type as string,
    success_message: (form.success_message as string) ?? 'Submitted.',
    fields,
  }
}

export async function submitWebForm(
  route: string,
  values: Record<string, unknown>,
): Promise<{ name: string; message: string }> {
  const form = await loadForm(route)
  const allowed = new Set(fieldnames(form.web_fields))
  // Accept ONLY whitelisted fields — a submitter can't set arbitrary columns.
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) if (allowed.has(k)) clean[k] = v

  // Create through the normal lifecycle (validation, hooks). The web form is a
  // trusted server-controlled surface, so it creates as Administrator but is
  // strictly limited to the configured DocType + whitelisted fields.
  const doc = await saveDoc(form.document_type as string, clean, 'Administrator')
  return {
    name: doc.name as string,
    message: (form.success_message as string) ?? 'Submitted.',
  }
}

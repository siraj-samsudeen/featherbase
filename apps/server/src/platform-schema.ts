// @spec platform_storage_is_explicit
export const PLATFORM_SCHEMA = 'featherbase'
export const SITE_REGISTRY_RELATION = 'public.site'

// Physical basenames owned by Featherbase at the cf88a7b convergence boundary.
// Metadata-backed user Tables are resolved separately by tableRelation().
const PLATFORM_RELATIONS = new Set([
  'access_log', 'access_token', 'activity_log', 'assignment_rule',
  'assignment_rule_user', 'auto_email_report', 'background_job', 'client_script',
  'column_def', 'comment', 'custom_field', 'dashboard', 'data_scope', 'data_source',
  'dataset_miss', 'dataset_snapshot', 'email_account', 'email_queue', 'email_rule',
  'email_sink', 'file', 'has_role', 'home_page', 'home_page_link', 'home_page_role',
  'import_log', 'installed_app', 'internal_metadata', 'job_execution', 'letter_head',
  'metadata_override', 'migration', 'notification_log', 'password_reset', 'patch_log',
  'permission', 'pre_auth_bucket', 'print_format', 'report', 'role',
  'runtime_action_result',
  'sales_target_snapshot_row', 'saved_view', 'scheduled_job', 'series', 'server_script',
  'service_level_agreement', 'share', 'single_value', 'sla_priority', 'table_def',
  'tag_link', 'todo', 'translation', 'user', 'user_event', 'user_settings', 'version',
  'web_form', 'web_page', 'webhook', 'workflow', 'workflow_action',
  'workflow_document_state', 'workflow_transition',
])

export function platformRelation(relation: string): string {
  return `${PLATFORM_SCHEMA}.${relation}`
}

// Existing SQL is routed at the tag boundary, never by a pooled search_path.
// Only syntactic relation operands with known platform basenames are changed;
// values, comments, CTE names, aliases and app/site relations are untouched.
export function qualifyPlatformSql(text: string): string {
  const relation = /(\b(?:from|join|update|into|table|references)\s+(?:(?:if\s+not\s+exists|only)\s+)?)("([a-z_][a-z0-9_]*)"|([a-z_][a-z0-9_]*))(?![a-z0-9_]|\s*\.)/gi
  const indexTarget = /(\bcreate\s+(?:unique\s+)?index\b[^;]*?\bon\s+)("([a-z_][a-z0-9_]*)"|([a-z_][a-z0-9_]*))(?![a-z0-9_]|\s*\.)/gi
  const rewrite = (_match: string, prefix: string, token: string, quoted: string, plain: string) => {
    const name = (quoted ?? plain).toLowerCase()
    return PLATFORM_RELATIONS.has(name) ? `${prefix}"${PLATFORM_SCHEMA}".${token}` : `${prefix}${token}`
  }

  let out = ''
  let start = 0
  let quote: "'" | '--' | '/*' | '$$' | null = null
  for (let i = 0; i <= text.length; i++) {
    if (quote === null) {
      const next = text.slice(i, i + 2)
      if (text[i] === "'" || next === '--' || next === '/*' || next === '$$') {
        const chunk = text.slice(start, i)
        out += chunk.replace(relation, rewrite).replace(indexTarget, rewrite)
        start = i
        quote = next === '--' || next === '/*' || next === '$$' ? next : "'"
        if (quote.length === 2) i++
      }
    } else if (quote === '--' && (text[i] === '\n' || i === text.length)) {
      out += text.slice(start, i)
      start = i
      quote = null
    } else if (quote === '/*' && text.slice(i, i + 2) === '*/') {
      i++
      out += text.slice(start, i + 1)
      start = i + 1
      quote = null
    } else if (quote === '$$' && text.slice(i, i + 2) === '$$' && i > start) {
      i++
      out += text.slice(start, i + 1)
      start = i + 1
      quote = null
    } else if (quote === "'" && text[i] === quote) {
      if (text[i + 1] === quote) i++
      else {
        out += text.slice(start, i + 1)
        start = i + 1
        quote = null
      }
    }
  }
  if (start < text.length) {
    const chunk = text.slice(start)
    out += quote === null ? chunk.replace(relation, rewrite).replace(indexTarget, rewrite) : chunk
  }
  return out
}

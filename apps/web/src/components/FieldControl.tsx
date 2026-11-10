import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { choiceLabel, tableHref, INSTANCE_SETTINGS_FILE } from 'shared'
import { api } from '../lib/api'
import { useIsSystemManager } from '../lib/session'
import type { ColumnDef, TableMeta } from '../lib/meta'
import { formatValue, useSettings } from '../lib/settings'
import { useI18n } from '../lib/i18n'
import {
  UnlinkedNote,
  unlinkedSourceTable,
} from './FormArrangement'
import { GlossaryHelp } from './GlossaryHelp'
import { inputClasses, labelClasses } from '@featherbase/shop-floor'
import type { Row } from './form-row'
import { LinkControl, anyTableFilters } from './LinkControl'
import { AttachControl } from './AttachControl'
import { ChildGrid } from './ChildGrid'

export function FieldControl({
  field,
  value,
  error,
  onChange,
  meta,
  values,
  setField,
  managedHint,
  errors,
  columns,
}: {
  columns: 1 | 2
  field: ColumnDef
  value: unknown
  error?: string
  /** Every field's error, keyed as the server names them; a grid of nested
   *  rows shows its cells' (`lines.0.customer`) in place (#832). */
  errors: Record<string, string>
  onChange: (value: unknown) => void
  meta: TableMeta
  values: Row
  setField: (columnName: string, value: unknown) => void
  /** #465 D5: set when the instance settings file sets this field. */
  managedHint?: string
}) {
  const settings = useSettings()
  const { t } = useI18n()
  const base = inputClasses()
  const instanceId = useId()
  const controlId = `${instanceId}-${field.column_name}`
  const labelId = `${controlId}-label`
  const label = (
    <label htmlFor={controlId} className={labelClasses()}>
      <span id={labelId}>{t(field.label ?? field.column_name)}</span>
      {field.reqd && <span aria-hidden="true" className="text-negative"> *</span>}
      <GlossaryHelp table={meta.name} column={field.column_name} className="ml-1" />
    </label>
  )
  // SET-004: below Date/Currency/Float inputs, show the value as it renders
  // globally (native inputs can't honor a custom format), so the form
  // reflects System Settings just like lists do.
  const preview =
    value != null && value !== '' && ['Date', 'Datetime', 'Currency', 'Float'].includes(field.column_type) ? (
      <p className="mt-1 text-xs text-ink-subtle" data-testid={`preview-${field.column_name}`}>
        {formatValue(field.column_type, value, settings)}
      </p>
    ) : null
  const err = error && (
    <p className="mt-1 text-xs text-negative" data-testid={`error-${field.column_name}`}>
      {error}
    </p>
  )
  // #473: the column's own description, from its metadata.
  const hintText = field.description?.trim() || null
  const hintId = `${controlId}-hint`
  const hint = hintText ? (
    <p id={hintId} className="mt-1 text-xs text-ink-subtle" data-testid={`hint-${field.column_name}`}>
      {t(hintText)}
    </p>
  ) : null
  const managedId = `${controlId}-managed`
  const managedNote = managedHint ? (
    <p id={managedId} className="mt-1 text-xs text-ink-subtle" data-testid={`managed-${field.column_name}`}>
      {withFileName(t(managedHint))}
    </p>
  ) : null
  // #796: a column whose source foreign key has no connected table to link
  // to says so, and offers a System Manager the table to connect.
  const unlinkedTarget = unlinkedSourceTable(field, meta)
  const unlinkedId = `${controlId}-unlinked`
  const unlinkedNote = <UnlinkedNote id={unlinkedId} field={field} meta={meta} />
  // #1021: a link to a view whose row has since left it keeps the link, and
  // says so; a new value must still be one of the view's rows.
  const outsideView = Array.isArray(values.links_outside_view) && values.links_outside_view.includes(field.column_name)
  const outsideNote = outsideView ? (
    <p className="mt-1 text-xs text-caution" data-testid={`outside-view-${field.column_name}`}>
      No longer in the {field.reference_table} view. The link stays as it is; a new choice must be one of them.
    </p>
  ) : null
  const describedBy = [hintText ? hintId : null, managedHint ? managedId : null, unlinkedTarget ? unlinkedId : null]
    .filter(Boolean)
    .join(' ')
  const common = {
    id: controlId,
    'aria-labelledby': labelId,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    'aria-required': field.reqd || undefined,
    disabled: field.read_only,
    'data-field': field.column_name,
    'data-fieldtype': field.column_type,
  }

  const wide = ['Text', 'Long Text', 'JSON', 'Sub-table'].includes(field.column_type)
  const wrap = (control: React.ReactNode) => (
    <div className={`min-w-0 ${wide && columns === 2 ? '@2xl:col-span-2' : ''}`} data-form-field={field.column_name} data-label={field.label ?? field.column_name}>
      {label}
      {control}
      {hint}
      {managedNote}
      {unlinkedNote}
      {outsideNote}
      {meta.name === 'Person' && field.column_name === 'roles' && <EveryoneRolesNote />}
      {preview}
      {err}
    </div>
  )

  switch (field.column_type) {
    case 'Check':
      return wrap(
        // On a touch screen the label around the box (no text of its own, so
        // the field's name is unchanged) is the thumb-sized target (index.css).
        <label className="inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4 pointer-coarse:size-5"
            {...common}
          />
        </label>,
      )
    case 'Choice':
      return wrap(
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={base}
          {...common}
        >
          <option value="" />
          {(field.choices ?? '')
            .split('\n')
            .filter(Boolean)
            .map((o) => (
              <option key={o} value={o}>
                {choiceLabel(o, field.choice_labels, t)}
              </option>
            ))}
        </select>,
      )
    case 'Date':
      return wrap(
        <input
          type="date"
          value={value ? String(value).slice(0, 10) : ''}
          onChange={(e) => onChange(e.target.value || null)}
          className={base}
          {...common}
        />,
      )
    case 'Datetime':
      return wrap(
        <input
          type="datetime-local"
          value={value ? toLocalDatetime(String(value)) : ''}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
          className={base}
          {...common}
        />,
      )
    case 'Int':
    case 'Float':
    case 'Currency':
      return wrap(
        <input
          type="number"
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          className={base}
          {...common}
        />,
      )
    case 'Text':
    case 'Long Text':
      return wrap(
        <textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className={base}
          {...common}
        />,
      )
    case 'JSON':
      return wrap(
        <textarea
          value={typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className={inputClasses('font-mono')}
          {...common}
        />,
      )
    case 'Sub-table':
      return wrap(
        <ChildGrid
          id={controlId}
          labelledBy={labelId}
          field={field}
          rows={(values[field.column_name] as Row[] | undefined) ?? []}
          onChange={(rows) => setField(field.column_name, rows)}
          errors={errors}
        />,
      )
    case 'Reference': {
      // #881: a link to a row of any Table takes its Table from the row's own
      // Table column, chosen first; a Table column offers only the Tables its
      // row column allows, and choosing another Table clears the row.
      if (field.table_column) {
        const chosen = values[field.table_column]
        if (chosen == null || chosen === '')
          return wrap(
            <input type="text" className={base} {...common} disabled value="" placeholder="Choose its Table first" />,
          )
        return wrap(
          <LinkControl
            key={String(chosen)}
            field={{ ...field, reference_table: String(chosen) }}
            value={value}
            onChange={onChange}
            className={base}
            common={common}
            anyTable
          />,
        )
      }
      const bound = field.reference_table === 'Table'
        ? meta.columns.filter((c) => c.table_column === field.column_name)
        : []
      return wrap(
        <LinkControl
          field={field}
          value={value}
          onChange={bound.length ? (next) => {
            if (next !== value) for (const row of bound) setField(row.column_name, null)
            onChange(next)
          } : onChange}
          className={base}
          common={common}
          extraFilters={bound.length ? anyTableFilters(bound) : undefined}
        />,
      )
    }
    case 'Attach':
    case 'Attach Image':
      return wrap(
        <AttachControl
          field={field}
          value={value}
          onChange={onChange}
          common={common}
          refTable={meta.name}
          refName={typeof values.row_id === 'string' ? values.row_id : undefined}
        />,
      )
    default:
      return wrap(
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value || null)}
          className={base}
          {...common}
        />,
      )
  }
}

// The settings file's name never breaks at its hyphen on a narrow screen.
function withFileName(text: string): React.ReactNode {
  const parts = text.split(INSTANCE_SETTINGS_FILE)
  return parts.flatMap((part, i) =>
    i === 0
      ? [part]
      : [
          <span key={i} className="whitespace-nowrap" data-testid="settings-file-name">
            {INSTANCE_SETTINGS_FILE}
          </span>,
          part,
        ],
  )
}

function toLocalDatetime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// #923: the roles System Settings gives everyone who signs in are held by this
// person too, though they are not in the list above. A System Manager, who can
// change both, sees them named here.
function EveryoneRolesNote() {
  const isManager = useIsSystemManager()
  const { data } = useQuery({
    queryKey: ['doc', 'System Settings', 'System Settings'],
    enabled: isManager,
    queryFn: () => api.get<{ everyone_roles?: string | null }>('/api/table/System%20Settings/System%20Settings'),
  })
  const roles = String(data?.everyone_roles ?? '').split('\n').map((r) => r.trim()).filter(Boolean)
  if (!roles.length) return null
  return (
    <p className="mt-1 text-xs text-ink-muted" data-testid="everyone-roles-note">
      Everyone who signs in also holds {roles.join(', ')}, set in{' '}
      <RouterLink to={tableHref('System Settings')} className="text-action hover:underline">System Settings</RouterLink>.
    </p>
  )
}

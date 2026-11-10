import { useEffect, useState, type ReactNode } from 'react'
import type { RecordData } from './api'
import { configuredTypes, fields, kinds, person, stateLabel, type ConfiguredField } from './ticket-words'

export function Label({ children, title }: { children: ReactNode; title: string }) {
  return (
    <label>
      <span>{title}</span>
      {children}
    </label>
  )
}
export function TypeSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {!kinds[value] && configuredTypes[value]?.enabled === false && <option value={value}>{configuredTypes[value].label}</option>}
      {!kinds[value] && !configuredTypes[value] && <option value={value}>{stateLabel(value)}</option>}
      {Object.entries(kinds).map(([key, name]) => (
        <option key={key} value={key}>
          {name}
        </option>
      ))}
      {Object.values(configuredTypes).filter((type) => type.enabled !== false).map((type) => (
        <option key={type.key} value={type.key}>
          {type.label}
        </option>
      ))}
    </select>
  )
}
export function Structured({
  kind,
  values,
  change,
  fields: asked,
}: {
  kind: string
  values: RecordData
  change: (key: string, value: string) => void
  fields?: ConfiguredField[]
}) {
  const configured = asked ? { fields: asked } : configuredTypes[kind]
  if (configured)
    return (
      <div className="form-grid">
        {configured.fields.filter((field) => asked || !field.asked_by_action).map((field) => {
          const value = String(values[field.name] ?? '')
          const title = field.required ? `${field.label} *` : field.label
          const set = (next: string) => change(field.name, next)
          return (
            <Label key={field.name} title={title}>
              {field.type === 'long text' ? (
                <textarea rows={3} value={value} required={field.required} onChange={(e) => set(e.target.value)} />
              ) : field.type === 'person' ? (
                <PersonPicker value={value} required={field.required} onChange={set} />
              ) : field.type === 'choice' || field.type === 'link' ? (
                <select value={value} required={field.required} onChange={(e) => set(e.target.value)}>
                  <option value="">Choose…</option>
                  {(field.type === 'choice'
                    ? (field.choices ?? []).map((choice) => ({ value: choice, label: choice }))
                    : (field.options ?? [])
                  ).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input type={field.type === 'date' ? 'date' : 'text'} value={value} required={field.required} onChange={(e) => set(e.target.value)} />
              )}
            </Label>
          )
        })}
      </div>
    )
  return (
    <div className="form-grid">
      {(fields[kind] ?? []).map(([key, title, type]) => (
        <Label key={key} title={title}>
          <input
            type={type ?? 'text'}
            value={String(values[key] ?? '')}
            onChange={(e) => change(key, e.target.value)}
          />
        </Label>
      ))}
    </div>
  )
}
// Any Person the signed-in person may see, found by name through the
// platform's people picker (the Person permission applies).
function PersonPicker({ value, required, onChange }: { value: string; required: boolean; onChange: (value: string) => void }) {
  const [query, setQuery] = useState(''),
    [found, setFound] = useState<{ row_id: string; label: string }[]>([]),
    [note, setNote] = useState('')
  useEffect(() => {
    const timer = setTimeout(async () => {
      const token = localStorage.getItem('fc_token')
      const response = await fetch(`/api/people/pick?q=${encodeURIComponent(query)}&limit=20`, {
        credentials: 'same-origin', headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => null)
      if (!response?.ok) {
        setFound([])
        setNote('You cannot look people up here.')
        return
      }
      setNote('')
      setFound(((await response.json()) as { people: { row_id: string; label: string }[] }).people)
    }, 250)
    return () => clearTimeout(timer)
  }, [query])
  return (
    <>
      <input type="search" placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select value={value} required={required} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {value && !found.some((p) => p.row_id === value) && <option value={value}>{person(value)}</option>}
        {found.map((p) => (
          <option key={p.row_id} value={p.row_id}>{p.label}</option>
        ))}
      </select>
      {note && <small className="fine">{note}</small>}
    </>
  )
}

import { useState } from "react";
import type { FormEvent } from "react";
import type {
  DocTypeDefinition,
  FieldDefinition,
  RecordData,
} from "../../convex/doctype/definition";

type Draft = Record<string, string | boolean>;

function initialDraft(definition: DocTypeDefinition, initial: RecordData) {
  const draft: Draft = {};
  for (const field of definition.fields) {
    const value = initial[field.name];
    draft[field.name] =
      field.type === "boolean"
        ? value === true
        : value === undefined
          ? ""
          : String(value);
  }
  return draft;
}

// Empty inputs are omitted, not sent as "": an unset field must have no
// sidecar row (capability 2), so the form never fabricates empty values. An
// unchecked checkbox therefore means unset, not false (research §3).
function collectData(definition: DocTypeDefinition, draft: Draft): RecordData {
  const data: RecordData = {};
  for (const field of definition.fields) {
    const value = draft[field.name];
    if (field.type === "boolean") {
      if (value === true) data[field.name] = true;
    } else if (typeof value === "string" && value !== "") {
      data[field.name] = field.type === "number" ? Number(value) : value;
    }
  }
  return data;
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}) {
  const id = `record-${field.name}`;
  if (field.type === "boolean") {
    return (
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }
  if (field.type === "select") {
    return (
      <select
        id={id}
        required={field.required}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value=""></option>
        {field.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      id={id}
      type={field.type === "number" ? "number" : "text"}
      required={field.required}
      value={String(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function RecordForm({
  definition,
  initial = {},
  onSubmit,
}: {
  definition: DocTypeDefinition;
  initial?: RecordData;
  onSubmit: (data: RecordData) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    initialDraft(definition, initial),
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await onSubmit(collectData(definition, draft));
    } catch (submitError) {
      setError(String(submitError));
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      {definition.fields.map((field) => (
        <div key={field.name}>
          <label htmlFor={`record-${field.name}`}>
            {field.label ?? field.name}
          </label>
          <FieldControl
            field={field}
            value={draft[field.name] ?? ""}
            onChange={(value) =>
              setDraft((current) => ({ ...current, [field.name]: value }))
            }
          />
        </div>
      ))}
      {error !== null && <p role="alert">{error}</p>}
      <button type="submit">Save</button>
    </form>
  );
}

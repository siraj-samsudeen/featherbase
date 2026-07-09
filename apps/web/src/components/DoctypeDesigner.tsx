import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import {
  FIELD_TYPES,
  type FieldDefinition,
  type FieldType,
} from "../../convex/doctype/definition";

// Draft state keeps everything as form-friendly strings/booleans; the real
// validation stays server-side in validateDefinition — the designer only
// assembles a definition and surfaces the thrown message.
interface FieldDraft {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  filterable: boolean;
  options: string;
}

const emptyField: FieldDraft = {
  name: "",
  label: "",
  type: "text",
  required: false,
  filterable: false,
  options: "",
};

// Empty inputs are omitted so the stored definition is already in normalized
// form (flags only when true — capability 2's canonical serialization).
function draftToField(draft: FieldDraft): FieldDefinition {
  const field: FieldDefinition = { name: draft.name, type: draft.type };
  if (draft.label !== "") field.label = draft.label;
  if (draft.required) field.required = true;
  if (draft.filterable) field.filterable = true;
  if (draft.type === "select") {
    field.options = draft.options
      .split(",")
      .map((option) => option.trim())
      .filter((option) => option !== "");
  }
  return field;
}

export function DoctypeDesigner() {
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<FieldDraft[]>([{ ...emptyField }]);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation(api.doctypes.create);
  const navigate = useNavigate();

  function patchField(index: number, patch: Partial<FieldDraft>) {
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const definition = {
      name,
      ...(label === "" ? {} : { label }),
      fields: fields.map(draftToField),
    };
    try {
      await create({ definition });
      await navigate({ to: "/doctypes/$doctype", params: { doctype: name } });
    } catch (submitError) {
      setError(String(submitError));
    }
  }

  return (
    <section>
      <h2>New DocType</h2>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor="doctype-name">Name</label>
        <input
          id="doctype-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <label htmlFor="doctype-label">Label</label>
        <input
          id="doctype-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        {fields.map((field, index) => (
          <fieldset key={index}>
            <label htmlFor={`field-${index}-name`}>Field name</label>
            <input
              id={`field-${index}-name`}
              value={field.name}
              onChange={(event) =>
                patchField(index, { name: event.target.value })
              }
            />
            <label htmlFor={`field-${index}-label`}>Field label</label>
            <input
              id={`field-${index}-label`}
              value={field.label}
              onChange={(event) =>
                patchField(index, { label: event.target.value })
              }
            />
            <label htmlFor={`field-${index}-type`}>Field type</label>
            <select
              id={`field-${index}-type`}
              value={field.type}
              onChange={(event) =>
                patchField(index, { type: event.target.value as FieldType })
              }
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <label htmlFor={`field-${index}-required`}>Required</label>
            <input
              id={`field-${index}-required`}
              type="checkbox"
              checked={field.required}
              onChange={(event) =>
                patchField(index, { required: event.target.checked })
              }
            />
            <label htmlFor={`field-${index}-filterable`}>Filterable</label>
            <input
              id={`field-${index}-filterable`}
              type="checkbox"
              checked={field.filterable}
              onChange={(event) =>
                patchField(index, { filterable: event.target.checked })
              }
            />
            {field.type === "select" && (
              <>
                <label htmlFor={`field-${index}-options`}>Options</label>
                <input
                  id={`field-${index}-options`}
                  value={field.options}
                  onChange={(event) =>
                    patchField(index, { options: event.target.value })
                  }
                />
              </>
            )}
            <button
              type="button"
              onClick={() =>
                setFields((current) => current.filter((_, i) => i !== index))
              }
            >
              Remove field
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() =>
            setFields((current) => [...current, { ...emptyField }])
          }
        >
          Add field
        </button>
        {error !== null && <p role="alert">{error}</p>}
        <button type="submit">Create DocType</button>
      </form>
    </section>
  );
}

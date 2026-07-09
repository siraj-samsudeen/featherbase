import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
import type {
  DocTypeDefinition,
  RecordData,
} from "../../convex/doctype/definition";
import type { RecordDoc } from "../../convex/doctype/repository";
import { RecordForm } from "./RecordForm";

// Only the definition's own fields feed the form — system fields are
// displayed read-only above it.
function userData(definition: DocTypeDefinition, record: RecordDoc) {
  const data: RecordData = {};
  for (const field of definition.fields) {
    const value = record[field.name];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      data[field.name] = value;
    }
  }
  return data;
}

export function RecordDetail({
  definition,
  id,
}: {
  definition: DocTypeDefinition;
  id: string;
}) {
  const { data: record } = useQuery(
    convexQuery(api.records.get, { doctype: definition.name, id }),
  );
  const update = useMutation(api.records.update);
  const remove = useMutation(api.records.remove);
  const navigate = useNavigate();

  if (record === undefined) return <p>Loading record…</p>;
  if (record === null) return <p>Record not found</p>;

  async function toGrid() {
    await navigate({
      to: "/doctypes/$doctype",
      params: { doctype: definition.name },
    });
  }

  return (
    <section>
      <h2>{definition.label ?? definition.name} record</h2>
      <dl>
        <dt>Owner</dt>
        <dd>{typeof record.owner === "string" ? record.owner : ""}</dd>
        <dt>Created</dt>
        <dd>{new Date(Number(record.creation)).toISOString()}</dd>
        <dt>Modified</dt>
        <dd>{new Date(Number(record.modified)).toISOString()}</dd>
      </dl>
      <RecordForm
        definition={definition}
        initial={userData(definition, record)}
        onSubmit={async (data) => {
          await update({ doctype: definition.name, id, data });
          await toGrid();
        }}
      />
      <button
        type="button"
        onClick={() =>
          void remove({ doctype: definition.name, id }).then(() => toGrid())
        }
      >
        Delete
      </button>
    </section>
  );
}

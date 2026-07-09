import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { DoctypeGate } from "../../../components/DoctypeGate";
import { RecordForm } from "../../../components/RecordForm";

export const Route = createFileRoute("/doctypes/$doctype/new")({
  component: NewRecordPage,
});

function NewRecordPage() {
  const { doctype } = Route.useParams();
  const create = useMutation(api.records.create);
  const navigate = useNavigate();
  return (
    <DoctypeGate name={doctype}>
      {(definition) => (
        <RecordForm
          definition={definition}
          onSubmit={async (data) => {
            await create({ doctype, data });
            await navigate({ to: "/doctypes/$doctype", params: { doctype } });
          }}
        />
      )}
    </DoctypeGate>
  );
}

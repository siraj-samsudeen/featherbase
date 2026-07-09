import { createFileRoute } from "@tanstack/react-router";
import { DoctypeGate } from "../../../components/DoctypeGate";
import { RecordGrid } from "../../../components/RecordGrid";

export const Route = createFileRoute("/doctypes/$doctype/")({
  component: GridPage,
});

function GridPage() {
  const { doctype } = Route.useParams();
  return (
    <DoctypeGate name={doctype}>
      {(definition) => <RecordGrid definition={definition} />}
    </DoctypeGate>
  );
}

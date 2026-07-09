import { createFileRoute } from "@tanstack/react-router";
import { DoctypeGate } from "../../../components/DoctypeGate";
import { RecordDetail } from "../../../components/RecordDetail";

export const Route = createFileRoute("/doctypes/$doctype/$id")({
  component: DetailPage,
});

function DetailPage() {
  const { doctype, id } = Route.useParams();
  return (
    <DoctypeGate name={doctype}>
      {/* Keyed so the form draft can't leak across param-only navigation
          between record ids (RecordForm seeds its draft once on mount). */}
      {(definition) => (
        <RecordDetail key={id} definition={definition} id={id} />
      )}
    </DoctypeGate>
  );
}

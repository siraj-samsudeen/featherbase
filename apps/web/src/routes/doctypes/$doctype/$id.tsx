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
      {(definition) => <RecordDetail definition={definition} id={id} />}
    </DoctypeGate>
  );
}

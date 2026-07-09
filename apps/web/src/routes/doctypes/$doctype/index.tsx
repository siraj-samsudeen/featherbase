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
      {/* Keyed so sort/filter state can't leak across param-only navigation
          between DocTypes (a stale sort field would make records.list reject). */}
      {(definition) => (
        <RecordGrid key={definition.name} definition={definition} />
      )}
    </DoctypeGate>
  );
}

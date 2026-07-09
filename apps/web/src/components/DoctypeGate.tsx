import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../convex/_generated/api";
import type { StoredDoctype } from "../../convex/doctype/repository";

// Grid, record form, and detail all need the definition before they can
// render anything metadata-driven; the loading and unknown-name states live
// here once so each has exactly one owning test (matrix G12, G13).
export function DoctypeGate({
  name,
  children,
}: {
  name: string;
  children: (definition: StoredDoctype) => ReactNode;
}) {
  const { data: definition } = useQuery(
    convexQuery(api.doctypes.get, { name }),
  );

  if (definition === undefined) return <p>Loading…</p>;
  if (definition === null) return <p>Unknown DocType “{name}”</p>;
  return <>{children(definition)}</>;
}

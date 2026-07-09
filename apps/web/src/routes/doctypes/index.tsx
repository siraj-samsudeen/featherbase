import { createFileRoute } from "@tanstack/react-router";
import { DoctypeList } from "../../components/DoctypeList";

export const Route = createFileRoute("/doctypes/")({
  component: DoctypeList,
});

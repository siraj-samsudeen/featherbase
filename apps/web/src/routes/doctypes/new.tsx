import { createFileRoute } from "@tanstack/react-router";
import { DoctypeDesigner } from "../../components/DoctypeDesigner";

export const Route = createFileRoute("/doctypes/new")({
  component: DoctypeDesigner,
});

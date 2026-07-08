import { createFileRoute } from "@tanstack/react-router";
import { TaskList } from "../components/TaskList";

export const Route = createFileRoute("/")({
  component: TaskList,
});

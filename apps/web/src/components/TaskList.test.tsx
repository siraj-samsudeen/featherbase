import { expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { test, renderWithConvexQueryAuth } from "../../convex/test.setup";
import { TaskList } from "./TaskList";

// Matrix rows I1–I4 (docs/capabilities/1-scaffold/2_spec.md)

// I1 — the loading state is transient with the real in-memory backend, so this
// is the one mocked state: a query client whose queries never resolve.
test("shows loading state while query pends", () => {
  const convex = new ConvexReactClient("https://test.convex.cloud");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: () => new Promise(() => undefined), retry: false },
    },
  });
  render(
    <ConvexProvider client={convex}>
      <QueryClientProvider client={queryClient}>
        <TaskList />
      </QueryClientProvider>
    </ConvexProvider>,
  );

  expect(screen.getByText("Loading…")).toBeInTheDocument();
});

test("shows empty state when no tasks", async ({ client }) => {
  renderWithConvexQueryAuth(<TaskList />, client);

  expect(await screen.findByText("No tasks yet")).toBeInTheDocument();
});

// I3 — the tracer bullet: seeded data through a real Convex function into
// a real React render.
test("shows seeded tasks", async ({ client, seed }) => {
  await seed("tasks", { text: "Buy milk", completed: false });

  renderWithConvexQueryAuth(<TaskList />, client);

  expect(screen.queryByText("NOT PRESENT — CI red check")).toBeInTheDocument();
  expect(screen.queryByText("No tasks yet")).not.toBeInTheDocument();
});

test("adds a task and shows it", async ({ client }) => {
  const user = userEvent.setup();
  renderWithConvexQueryAuth(<TaskList />, client);
  await screen.findByText("No tasks yet");

  await user.type(screen.getByLabelText("Task"), "Water the plants");
  await user.click(screen.getByRole("button", { name: "Add" }));

  expect(await screen.findByText("Water the plants")).toBeInTheDocument();
  expect(screen.getByLabelText("Task")).toHaveValue("");
});

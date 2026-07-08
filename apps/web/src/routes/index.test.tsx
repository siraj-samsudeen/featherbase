import { expect } from "vitest";
import { screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { test, renderWithConvexQueryAuth } from "../../convex/test.setup";
import { routeTree } from "../routeTree.gen";

// Matrix row R1 (docs/capabilities/1-scaffold/2_spec.md)

test("renders the app shell at index", async ({ client }) => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  renderWithConvexQueryAuth(<RouterProvider router={router} />, client);

  expect(
    await screen.findByRole("heading", { name: "Featherbase" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("No tasks yet")).toBeInTheDocument();
});

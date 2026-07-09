import { expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test } from "../convex/test.setup";
import { renderApp } from "./test.fixtures";

// Matrix row T1 (docs/capabilities/3-auto-ui/2_spec.md) — the capability
// tracer bullet: a working app built through the UI alone, zero code.

test("builds a working app with zero code", async ({ client }) => {
  const user = userEvent.setup();
  renderApp(client, "/");

  // Design a DocType.
  await user.click(await screen.findByRole("link", { name: "DocTypes" }));
  await user.click(await screen.findByRole("link", { name: "New DocType" }));
  await user.type(await screen.findByLabelText("Name"), "book");
  await user.type(screen.getByLabelText("Label"), "Book");
  await user.type(screen.getByLabelText("Field name"), "title");
  await user.click(screen.getByLabelText("Required"));
  await user.click(screen.getByLabelText("Filterable"));
  await user.click(screen.getByRole("button", { name: "Add field" }));
  await user.type(screen.getAllByLabelText("Field name")[1]!, "pages");
  await user.selectOptions(
    screen.getAllByLabelText("Field type")[1]!,
    "number",
  );
  await user.click(screen.getAllByLabelText("Filterable")[1]!);
  await user.click(screen.getByRole("button", { name: "Create DocType" }));
  expect(await screen.findByText("No records yet")).toBeInTheDocument();

  // Add a record through the generated form.
  await user.click(screen.getByRole("link", { name: "New Book" }));
  await user.type(await screen.findByLabelText("title"), "Dune");
  await user.type(screen.getByLabelText("pages"), "412");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Dune")).toBeInTheDocument();
  expect(screen.getByText("412")).toBeInTheDocument();

  // Open the detail view, edit, save.
  await user.click(screen.getByText("Dune"));
  const pages = await screen.findByLabelText("pages");
  await user.clear(pages);
  await user.type(pages, "500");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("500")).toBeInTheDocument();

  // Delete the record.
  await user.click(screen.getByText("Dune"));
  await user.click(await screen.findByRole("button", { name: "Delete" }));
  expect(await screen.findByText("No records yet")).toBeInTheDocument();
});

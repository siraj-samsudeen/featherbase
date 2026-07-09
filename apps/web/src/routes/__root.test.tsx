import { expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test } from "../../convex/test.setup";
import { renderApp, renderAuthLoading } from "../test.fixtures";

// Matrix rows A1–A5 (docs/capabilities/4-sign-in/research-spec-plan.md)

test("shows sign-in state when unauthenticated", async ({ client }) => {
  renderApp(client, "/", { authenticated: false });

  expect(
    await screen.findByRole("button", { name: "Get started" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "DocTypes" }),
  ).not.toBeInTheDocument();
});

test("signs in when get-started is clicked", async ({ client }) => {
  const user = userEvent.setup();
  renderApp(client, "/", { authenticated: false });

  await user.click(await screen.findByRole("button", { name: "Get started" }));

  expect(
    await screen.findByRole("link", { name: "DocTypes" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("No tasks yet")).toBeInTheDocument();
});

test("shows error when sign-in fails", async ({ client }) => {
  const user = userEvent.setup();
  renderApp(client, "/", {
    authenticated: false,
    signInError: new Error("sign-in unavailable"),
  });

  await user.click(await screen.findByRole("button", { name: "Get started" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "sign-in unavailable",
  );
  expect(
    screen.getByRole("button", { name: "Get started" }),
  ).toBeInTheDocument();
});

test("signs out back to the sign-in state", async ({ client }) => {
  const user = userEvent.setup();
  renderApp(client, "/");

  await user.click(await screen.findByRole("button", { name: "Sign out" }));

  expect(
    await screen.findByRole("button", { name: "Get started" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "DocTypes" }),
  ).not.toBeInTheDocument();
});

test("shows loading state while auth pends", async () => {
  renderAuthLoading("/");

  expect(await screen.findByText("Loading…")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Get started" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "DocTypes" }),
  ).not.toBeInTheDocument();
});

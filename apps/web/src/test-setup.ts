import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollTo; TanStack Router's scroll restoration calls it.
Object.defineProperty(window, "scrollTo", {
  value: () => undefined,
  writable: true,
});

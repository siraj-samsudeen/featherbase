import { treaty } from "@elysiajs/eden";
import { describe, expect, it } from "bun:test";
import { app } from "./app";

const api = treaty(app);

describe("GET /", () => {
  it("greets", async () => {
    const { data } = await api.get();
    expect(data).toBe("Hello Elysia, Siraj");
  });
});

describe("GET /health", () => {
  it("reports ok", async () => {
    const { status, data } = await api.health.get();
    expect(status).toBe(200);
    expect(data).toEqual({ status: "ok" });
  });
});

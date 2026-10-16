import { describe, expect, it } from "bun:test";
import { app } from "./app";

describe("GET /", () => {
  it("greets", async () => {
    const res = await app.handle(new Request("http://localhost/"));
    expect(await res.text()).toBe("Hello Elysia, Siraj");
  });
});

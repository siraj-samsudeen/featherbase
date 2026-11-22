import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { casesIn, featherbaseInABrowser } from "../../../testing.ts";

const { openInNewTab } = featherbaseInABrowser();

const handWritten: { [part: string]: RegExp } = {
  Button: /<(button|a)[^>]*class="btn/,
  Tag: /class="tag"/,
};

test("The Parts page shows every part by name, with where it lives and how it looks.", async () => {
  const { page } = await openInNewTab("/parts");
  const shown = await page.locator(".part").evaluateAll((parts) =>
    parts.map((part) => [
      part.querySelector("h2")?.textContent,
      part.querySelector(".mono")?.textContent,
      String((part.querySelector(".sample")?.children.length ?? 0) > 0),
    ]),
  );
  const written = casesIn("features/foundations/parts/parts.md", "Lives in");
  expect(shown).toEqual(written.map(([part, livesIn]) => [part, livesIn, "true"]));
});

test("No page writes by hand what a part already writes.", () => {
  const found: string[] = [];
  for (const file of new Glob("**/*.ts").scanSync(".")) {
    if (file === "parts.ts" || file.endsWith(".test.ts") || file.startsWith("node_modules")) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [part, mark] of Object.entries(handWritten)) {
      for (const [index, line] of lines.entries()) if (mark.test(line)) found.push(`${file}:${index + 1} writes a ${part} by hand`);
    }
  }
  expect(found).toEqual([]);
});

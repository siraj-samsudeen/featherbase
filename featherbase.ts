import { html } from "@elysiajs/html";
import { Elysia } from "elysia";
import { proposalPage, tableProposedFrom } from "./features/importing-data/proposing/proposing.ts";
import { page } from "./page.ts";

const welcomePage = page("Featherbase", '<h1>Welcome to Featherbase</h1><a href="/import">Import data</a>');
const importDataPage = page(
  "Import data",
  "<h1>Import data</h1>" +
    '<form method="post" enctype="multipart/form-data">' +
    '<input type="file" name="file" onchange="this.form.submit()"></form>',
);
const notFoundPage = page("Page not found", "<h1>Page not found</h1>");

export function createFeatherbase() {
  return new Elysia()
    .use(html())
    .get("/", () => welcomePage)
    .get("/import", () => importDataPage)
    .post("/import", async ({ body }) => {
      const { file } = body as { file: File };
      return proposalPage(tableProposedFrom(file.name, await file.text()));
    })
    .onError(({ code }) => {
      if (code === "NOT_FOUND") return notFoundPage;
    });
}

import { html } from "@elysiajs/html";
import { Elysia } from "elysia";

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
    .post("/import", ({ body }) => proposalPage((body as { file: File }).file))
    .onError(({ code }) => {
      if (code === "NOT_FOUND") return notFoundPage;
    });
}

function proposalPage(file: File) {
  return page("Import data", `<h1>Import data</h1><h2>${tableNameFrom(file.name)}</h2>`);
}

function tableNameFrom(fileName: string) {
  const withoutEnding = fileName.replace(/\.[^.]*$/, "");
  return withoutEnding[0].toUpperCase() + withoutEnding.slice(1);
}

function page(title: string, body: string) {
  return `<!doctype html><title>${title}</title>${body}`;
}

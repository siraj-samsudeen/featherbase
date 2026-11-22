import { html } from "@elysiajs/html";
import { Elysia } from "elysia";

const welcomePage =
  '<!doctype html><title>Featherbase</title><h1>Welcome to Featherbase</h1><a href="/import">Import data</a>';
const importDataPage =
  "<!doctype html><title>Import data</title><h1>Import data</h1>" +
  '<form method="post" enctype="multipart/form-data">' +
  '<input type="file" name="file" onchange="this.form.submit()"></form>';
const notFoundPage = "<!doctype html><title>Page not found</title><h1>Page not found</h1>";

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
  return `<!doctype html><title>Import data</title><h1>Import data</h1><h2>${tableNameFrom(file.name)}</h2>`;
}

function tableNameFrom(fileName: string) {
  const withoutEnding = fileName.replace(/\.[^.]*$/, "");
  return withoutEnding[0].toUpperCase() + withoutEnding.slice(1);
}

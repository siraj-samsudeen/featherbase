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

async function proposalPage(file: File) {
  const [header, ...rows] = linesOf(await file.text()).map(cellsOf);
  const columns = header.map((name, index) => ({ name, type: typeOf(rows.map((row) => row[index])) }));
  return page(
    "Import data",
    `<h1>Import data</h1><h2>${tableNameFrom(file.name)}</h2><p>${rows.length} rows, ${header.length} Columns</p>` +
      `<table><thead><tr><th>Column</th><th>Type</th></tr></thead><tbody>${columns.map(columnRow).join("")}</tbody></table>`,
  );
}

function columnRow(column: { name: string; type: string }) {
  return `<tr><td>${column.name}</td><td>${column.type}</td></tr>`;
}

function typeOf(cells: string[]) {
  const filled = cells.filter(isFilled);
  if (filled.length === 0) return "Text";
  if (filled.every(isYesOrNo)) return "Yes/No";
  if (filled.every(isANumber)) return "Number";
  if (filled.every(isARealDate)) return "Date";
  return "Text";
}

function isFilled(cell: string) {
  return cell !== "";
}

function isYesOrNo(cell: string) {
  return cell === "true" || cell === "false";
}

function isANumber(cell: string) {
  return /^-?\d+(\.\d+)?$/.test(cell);
}

function isARealDate(cell: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cell) && isOnTheCalendar(cell);
}

function isOnTheCalendar(yearMonthDay: string) {
  return new Date(yearMonthDay).toJSON()?.startsWith(yearMonthDay) ?? false;
}

function linesOf(text: string) {
  return text.split("\n").filter((line) => line !== "");
}

function cellsOf(line: string) {
  return line.split(",");
}

function tableNameFrom(fileName: string) {
  const withoutEnding = fileName.replace(/\.[^.]*$/, "");
  return withoutEnding[0].toUpperCase() + withoutEnding.slice(1);
}

function page(title: string, body: string) {
  return `<!doctype html><title>${title}</title>${body}`;
}

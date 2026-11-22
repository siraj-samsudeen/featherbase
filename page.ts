export type TableLink = { name: string; address: string; rows: number; columns: number; changed: string; key?: string };
export type UploadLink = { name: string; address: string; rows: number; arrivedOn: string };
export type Frame = { tables: TableLink[]; uploads: UploadLink[]; said?: string };
export type View = { title: string; html: string };

const home = "/";
const fonts =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap";

export const stylesheetAddress = "/pages.css";
export const stylesheetFile = `${import.meta.dir}/features/foundations/pages/pages.css`;

export function page(view: View, frame: Frame, here = home) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    `<title>${asText(view.title)}</title>` +
    `<link rel="stylesheet" href="${fonts}"><link rel="stylesheet" href="${stylesheetAddress}"></head>` +
    `<body><div class="app">${sidebar(frame, here)}<main class="main">${view.html}${toast(frame.said)}</main></div></body></html>`
  );
}

function toast(said?: string) {
  return said ? `<p class="toast" role="status">${asText(said)}</p>` : "";
}

const feather =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M14 5c-4.5 1-7 4.5-7.5 10M9 9.5l3.5.5M7.5 12l2.5.5" ' +
  'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

function sidebar({ tables, uploads }: Frame, here: string) {
  return `
    <nav class="side" aria-label="Featherbase">
      <a class="brand" href="${home}">${feather}Featherbase</a>
      <div class="nav"><a href="${home}"${markIf(here === home)}>Home</a></div>
      ${tables.length > 0 ? group("Tables · main", tables.map((table, index) => tableLink(table, index, here))) : ""}
      ${uploads.length > 0 ? group("Uploads", uploads.map(uploadLink)) : ""}
    </nav>`;
}

function group(name: string, links: string[]) {
  return `<div class="group"><h2>${name}</h2><div class="nav">${links.join("")}</div></div>`;
}

function uploadLink(upload: UploadLink) {
  return `
    <a href="${upload.address}">
      <span class="ico c8" aria-hidden="true">Up</span>${asText(upload.name)} <span>${upload.rows}</span>
    </a>`;
}

function tableLink(table: TableLink, index: number, here: string) {
  return `
    <a href="${table.address}"${markIf(here === table.address)}>
      <span class="ico ${tintNumbered(index)}" aria-hidden="true">${asText(table.name.slice(0, 2))}</span>
      ${asText(table.name)} <span>${table.rows}</span>
    </a>`;
}

export function tintNumbered(index: number) {
  return `c${(index % 8) + 1}`;
}

function markIf(thisIsWhereThePersonIs: boolean) {
  return thisIsWhereThePersonIs ? ' aria-current="page"' : "";
}

export function chip(value: string, index: number) {
  return `<span class="chip ${tintNumbered(index)}">${asText(value)}</span>`;
}

export type Crumb = { name: string; address?: string };

export function bar(title: string, crumbs: Crumb[] = [], beside = "") {
  return `<div class="bar">${crumbs.length > 0 ? wayBack(crumbs) : ""}<h1>${asText(title)}</h1>${beside}</div>`;
}

function wayBack(crumbs: Crumb[]) {
  return `<nav class="crumbs" aria-label="You are here">${crumbs.map(crumb).join(" / ")}</nav>`;
}

function crumb({ name, address }: Crumb) {
  return address ? `<a href="${address}">${asText(name)}</a>` : asText(name);
}

export const homeCrumb = { name: "Home", address: home };
export const importDataCrumb = { name: "Import Data", address: "/import" };

export function asText(written: string) {
  return Bun.escapeHTML(written);
}

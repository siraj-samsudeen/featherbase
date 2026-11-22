export type TableLink = { name: string; address: string; rows: number };
export type View = { title: string; html: string };

const home = "/";
const fonts =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap";

export const stylesheetAddress = "/pages.css";
export const stylesheetFile = `${import.meta.dir}/features/foundations/pages/pages.css`;

export function page(view: View, tables: TableLink[], here = home) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    `<title>${asText(view.title)}</title>` +
    `<link rel="stylesheet" href="${fonts}"><link rel="stylesheet" href="${stylesheetAddress}"></head>` +
    `<body><div class="app">${sidebar(tables, here)}<main class="main">${view.html}</main></div></body></html>`
  );
}

function sidebar(tables: TableLink[], here: string) {
  return (
    `<nav class="side" aria-label="Featherbase"><a href="${home}">Featherbase</a><a href="${home}"${markIf(here === home)}>Home</a>` +
    `${tables.map((table) => tableLink(table, here)).join("")}</nav>`
  );
}

function tableLink(table: TableLink, here: string) {
  return (
    `<a href="${table.address}"${markIf(here === table.address)}>` +
    `${asText(table.name)} <span>${table.rows}</span></a>`
  );
}

function markIf(thisIsWhereThePersonIs: boolean) {
  return thisIsWhereThePersonIs ? ' aria-current="page"' : "";
}

export type Crumb = { name: string; address?: string };

export function wayBack(crumbs: Crumb[]) {
  return `<nav class="crumbs" aria-label="You are here">${crumbs.map(crumb).join(" / ")}</nav>`;
}

function crumb({ name, address }: Crumb) {
  return address ? `<a href="${address}">${asText(name)}</a>` : asText(name);
}

export const homeCrumb = { name: "Home", address: home };
export const importDataCrumb = { name: "Import data", address: "/import" };

export function asText(written: string) {
  return Bun.escapeHTML(written);
}

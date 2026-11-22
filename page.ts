export type TableLink = { name: string; address: string; rows: number };
export type View = { title: string; html: string };

const home = "/";

export function page(view: View, tables: TableLink[], here = home) {
  return `<!doctype html><title>${asText(view.title)}</title>${sidebar(tables, here)}${view.html}`;
}

function sidebar(tables: TableLink[], here: string) {
  return (
    `<nav aria-label="Featherbase"><a href="${home}">Featherbase</a><a href="${home}"${markIf(here === home)}>Home</a>` +
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

export function asText(written: string) {
  return Bun.escapeHTML(written);
}

export type TableLink = { name: string; address: string; rows: number };
export type View = { title: string; html: string };

export function page(view: View, tables: TableLink[]) {
  return `<!doctype html><title>${asText(view.title)}</title>${sidebar(tables)}${view.html}`;
}

function sidebar(tables: TableLink[]) {
  return (
    '<nav aria-label="Featherbase"><a href="/">Featherbase</a><a href="/">Home</a>' +
    `${tables.map(tableLink).join("")}</nav>`
  );
}

function tableLink(table: TableLink) {
  return `<a href="${table.address}">${asText(table.name)} <span>${table.rows}</span></a>`;
}

export function asText(written: string) {
  return Bun.escapeHTML(written);
}

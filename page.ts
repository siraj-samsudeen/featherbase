export function page(title: string, body: string) {
  return `<!doctype html><title>${title}</title>${body}`;
}

export function asText(written: string) {
  return Bun.escapeHTML(written);
}

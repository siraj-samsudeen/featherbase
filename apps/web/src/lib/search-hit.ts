// #431: what a command-bar record hit IS. Registry rows (a Table's own
// definition, a Custom Field...) carry a server label; ordinary rows say
// which Table they live in.
export function searchHitKind(h: { table: string; kind_label?: string }): string {
  return h.kind_label ?? `row in ${h.table}`
}

// #859 (ADR 0019): whether a Table's rows can be retired. One rule for the
// server (which enforces it) and the Admin (which only offers what it allows):
// a plain Table that stores its own rows and is not one of the engine's own.
export function canRetire(meta: { name: string; kind?: string | null; data_source?: string | null; system_written?: boolean | null } | null | undefined): boolean {
  if (!meta) return false
  return (meta.kind ?? 'table') === 'table' && !meta.data_source && !meta.system_written
    && meta.name !== 'Table' && meta.name !== 'Column'
    // #1060: a grant ends in the permission matrix; retiring never changes who may see what.
    && meta.name !== 'Permission'
}

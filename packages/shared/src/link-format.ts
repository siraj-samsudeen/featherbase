// #1020: how links to a Table's rows read. A row's name and its code come from
// the Table's metadata; this says which of them a link shows, and in what order.
export const LINK_FORMATS = ['name_code', 'code_name', 'name', 'code'] as const

export type LinkFormat = (typeof LINK_FORMATS)[number]

export const DEFAULT_LINK_FORMAT: LinkFormat = 'name_code'

/** The words a person chooses between. */
export const LINK_FORMAT_LABELS: Record<LinkFormat, string> = {
  name_code: 'Name (code)',
  code_name: 'Code (name)',
  name: 'Name only',
  code: 'Code only',
}

/** A linked row as one string. A row with no separate code reads as its name in every format. */
export function linkText(format: LinkFormat | null | undefined, name: string, code?: string): string {
  if (!code) return name
  switch (format) {
    case 'code_name': return `${code} (${name})`
    case 'name': return name
    case 'code': return code
    default: return `${name} (${code})`
  }
}

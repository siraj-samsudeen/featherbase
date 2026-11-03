export interface CommandTableDestination {
  row_id: string
  label: string
  module: string
  system: boolean
  system_written: boolean
  kind: 'table' | 'settings'
  can_create: boolean
}

export interface CommandPageDestination {
  label: string
  href: string
  kind: string
  aliases?: string[]
}

export interface CommandDestinations {
  tables: CommandTableDestination[]
  pages: CommandPageDestination[]
}

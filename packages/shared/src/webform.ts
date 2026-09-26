export interface WebFormColumn {
  column_name: string
  label: string
  column_type: string
  reference_table: string | null
  choices: string | null
  reqd: boolean
}

export interface WebFormConfig {
  route: string
  title: string
  ref_table: string
  success_message: string
  columns: WebFormColumn[]
}

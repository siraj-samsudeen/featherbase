/** Display advice for an already readable row, never authorization for a write.
 * Mutation endpoints recheck permissions, current state and validation. */
export interface RowCapabilities {
  write: boolean
  rename: boolean
  delete: boolean
  submit: boolean
  cancel: boolean
  amend: boolean
  assign: boolean
  tag: boolean
  comment: boolean
  upload: boolean
}

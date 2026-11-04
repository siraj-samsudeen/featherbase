/** Display advice for an already readable row, never authorization for a write.
 * Mutation endpoints recheck permissions, current state and validation. */
export interface RowCapabilities {
  write: boolean
  rename: boolean
  delete: boolean
  submit: boolean
  cancel: boolean
  amend: boolean
  /** #859: retire needs the delete right; reactivate the write right. */
  retire: boolean
  reactivate: boolean
  /** #859: a System Manager may delete the row permanently, with its history. */
  purge: boolean
  assign: boolean
  tag: boolean
  comment: boolean
  upload: boolean
}

import type { Patch } from '../src/patches'
import { up as fileRefIndex } from './0001_file_ref_index'

// The ordered patch registry (Frappe's patches.txt equivalent). Append new
// patches to the END — order is significant and names must never change once
// shipped, since the patch_log records them by name.
export const patches: Patch[] = [
  { name: '0001_file_ref_index', up: fileRefIndex },
]

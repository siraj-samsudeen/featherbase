// #1016, #1019: a "Name" box reads as a login to a password manager, which then
// adds its icon to it, knocks it out of line and opens its own list over the
// picker's. Browsers read autocomplete; the rest are 1Password's, LastPass's,
// Bitwarden's and Dashlane's own marks.
export const NOT_A_LOGIN = {
  autoComplete: 'off',
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
}

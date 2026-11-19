// #1348: two kinds of column the calmer look draws its own way, read from the column's name.

/** Where a row came from (source, source_system): drawn as the shared tag, never a category tint. */
export const isSourceColumn = (name: string) => /(^|_)source(_|$)/.test(name)

/** A code that tells same-named rows apart (code, site_code), drawn small, mono and grey. A postal code is an
 *  address, not one of these. */
export const isCodeColumn = (name: string) => /(^|_)code$/.test(name) && !/(postal|zip|pin)_code$/.test(name)

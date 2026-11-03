// #855: the naming rule a new Table starts with when its maker picks none:
// plain numbers 1, 2, 3, counted per Table. The server's createTable and the
// web's builder and import wizard all read it from here.
export const DEFAULT_ID_PATTERN = 'integer'

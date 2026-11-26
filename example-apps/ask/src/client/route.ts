// Where a chat opens inside Ask. The router works below /ask, so a chat is "/?chat=14"
// to it, and the address bar shows /ask/?chat=14.
export function chatPath(chat: string): string {
  return `/?chat=${encodeURIComponent(chat)}`
}

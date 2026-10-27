// #666 fixture: an app with a required secret and an optional one (an
// optional embed integration). `quick_view` works without the embed;
// `embed` declares it needs the optional secret; `reach_embed` reaches it
// without declaring it, which the platform must refuse.
export const platformVersion = '2026-10'
export const calls = { handler: 0 }
const secretNames = (context) => {
  calls.handler++
  return { secrets: Object.keys(context.secrets).sort() }
}
export const reads = {
  quick_view: secretNames,
  embed: secretNames,
  reach_embed(context) {
    calls.handler++
    return { embed: typeof context.secrets.OPTPROOF_EMBED_KEY }
  },
}
export const actions = {
  note: secretNames,
  embed_note: secretNames,
}

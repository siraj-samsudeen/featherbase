// #1173's drawer, on the platform alone: an app that says what it can give one person and gives it.
// A gift row "odd" or "boom" for the person makes the options read answer badly or fail; a "peer" row makes its person a peer.
export const platformVersion = '2026-10'
const GIFTS = [['a', 'Apples'], ['b', 'Books'], ['fail', 'Refused one']]
export const reads = {
  async gift_options({ payload, documents }) {
    const person = payload?.person
    const held = (await documents.list('grantproof.gift', { fields: ['gift'], filters: [['person', '=', person]] })).map(row => row.gift)
    // Peers are the people a "peer" row names, so the drawer can count the roles they hold.
    const peers = (await documents.list('grantproof.gift', { fields: ['person'], filters: [['gift', '=', 'peer']] })).map(row => row.person)
    if (held.includes('boom')) throw new Error('Deliberate options failure')
    if (held.includes('odd')) return { nothing: 'useful' }
    return {
      about: [{ label: 'Job', value: 'Tester' }],
      peers: [...peers, person],
      choices: GIFTS.map(([id, label]) => ({ id: `gift:${id}`, label, group: 'Gift', given: held.includes(id), payload: { gift: id } })),
    }
  },
}
export const actions = {
  async give_gift({ payload, documents, reject }) {
    if (payload?.gift === 'fail') reject('Not this one')
    await documents.create('grantproof.gift', { person: payload.person, gift: payload.gift })
    return { given: payload.gift }
  },
}

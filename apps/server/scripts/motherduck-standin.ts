// #772 design D4: the local MotherDuck stand-in, for the acceptance suite and a
// local instance. `build` prints a new stand-in folder; `add <folder> <database>
// <table>` adds a table; `change` updates synthetic rows for copy journeys.
import { addStandinTable, buildStandin, changeStandin } from '../test/motherduck-standin'

const [command, ...args] = process.argv.slice(2)
if (command === 'build') console.log(await buildStandin())
else if (command === 'add' && args.length === 3) await addStandinTable(args[0], args[1], args[2])
else if (command === 'change' && args.length === 3) await changeStandin(args[0], args[1], JSON.parse(args[2]))
else {
  console.error('usage: motherduck-standin build | add <folder> <database> <table> | change <folder> <database> <statements-json>')
  process.exit(2)
}

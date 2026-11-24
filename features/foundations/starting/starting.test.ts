import { expect, test } from "bun:test";
import { aFreshDatabase } from "../../../testing.ts";

test("Running `bun start` opens Featherbase on the port and the database it is given.", async () => {
  const port = aFreePort();
  const database = await aFreshDatabase();
  const featherbase = runBunStartOn(port, database.address);
  try {
    const page = await pageOnceItAnswers(`http://localhost:${port}`);
    expect(page).toContain("Welcome To Featherbase");
  } finally {
    featherbase.kill();
    await featherbase.exited;
    await database.remove();
  }
});

function aFreePort() {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  return port;
}

function runBunStartOn(port: number | undefined, databaseAddress: string) {
  return Bun.spawn(["bun", "start"], {
    env: { ...process.env, PORT: String(port), DATABASE_URL: databaseAddress },
    stdout: "ignore",
    stderr: "ignore",
  });
}

async function pageOnceItAnswers(address: string) {
  const giveUpAt = Date.now() + 3000;
  while (true) {
    const page = await fetch(address).then(
      (response) => response.text(),
      () => undefined,
    );
    if (page !== undefined) return page;
    if (Date.now() > giveUpAt) throw new Error(`bun start did not open Featherbase at ${address}`);
    await Bun.sleep(50);
  }
}

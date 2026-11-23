import { afterAll, expect, test } from "bun:test";

let featherbase: ReturnType<typeof Bun.spawn> | undefined;

afterAll(() => {
  stopFeatherbase();
});

test("Running `bun start` opens Featherbase on the port it is given.", async () => {
  const port = aFreePort();
  runBunStartOn(port);
  const page = await pageOnceItAnswers(`http://localhost:${port}`);
  expect(page).toContain("Welcome to Featherbase");
});

function aFreePort() {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  return port;
}

function runBunStartOn(port: number | undefined) {
  featherbase = Bun.spawn(["bun", "start"], {
    env: { ...process.env, PORT: String(port) },
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

function stopFeatherbase() {
  featherbase?.kill();
}

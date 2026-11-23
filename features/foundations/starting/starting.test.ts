import { afterAll, beforeAll, expect, test } from "bun:test";

const address = "http://localhost:3210";
let featherbase: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  startFeatherbase();
  await waitUntilFeatherbaseAnswers();
});

afterAll(() => {
  stopFeatherbase();
});

test("Running `bun start` opens Featherbase on the port it is given.", async () => {
  const page = await fetch(address).then((response) => response.text());
  expect(page).toContain("Welcome to Featherbase");
});

function startFeatherbase() {
  featherbase = Bun.spawn(["bun", "start"], { env: { ...process.env, PORT: "3210" } });
}

async function waitUntilFeatherbaseAnswers() {
  const giveUpAt = Date.now() + 3000;
  while (!(await featherbaseAnswers())) {
    if (Date.now() > giveUpAt) throw new Error(`Featherbase did not start at ${address}`);
    await Bun.sleep(100);
  }
}

function featherbaseAnswers() {
  return fetch(address).then(
    () => true,
    () => false,
  );
}

function stopFeatherbase() {
  featherbase.kill();
}

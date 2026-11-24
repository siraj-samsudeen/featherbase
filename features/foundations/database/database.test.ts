import { expect, test } from "bun:test";
import { featherbaseInABrowser, tableOn } from "../../../testing.ts";

const { make, openInNewTab, restartFeatherbase } = featherbaseInABrowser();

test("Tables and their rows are still there after Featherbase is stopped and started again.", async () => {
  const before = await tableOn(await make("staff.csv", staffFile));
  await restartFeatherbase();
  const { page } = await openInNewTab("/tables/staff");
  expect(await tableOn(page)).toEqual(before);
});

test("Columns whose names differ only in capitals, spaces or marks each keep their own values.", async () => {
  const page = await make("marks.csv", ["Row,Unit Price,unit_price,UNIT-PRICE,₹", "1,first,second,third,fourth"]);
  expect((await tableOn(page))[1]).toEqual(["1", "first", "second", "third", "fourth"]);
});

const staffFile = [
  "Code,Name,Team,Joined,Active,Hours",
  "S1,Asha,Sales,2015-01-01,true,48",
  "S2,Bala,Sales,2016-06-04,false,37.5",
  "S3,Chitra,Stores,,true,",
  "S4,Dinesh,Stores,2018-04-10,true,40",
];

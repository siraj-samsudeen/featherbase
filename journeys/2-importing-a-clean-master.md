# Journey 2: importing a clean master

Runs in a real browser, with `samples/employees/employees.csv`, on a fresh install. It doubles as the product
demo.

This is build 1 as a person lives it. It doubles as the product demo, and it is the first test written: one
run through these steps in a real browser, with the sample file.

**Priya has an employee list in a spreadsheet. Two minutes later it is a working Table.**

1. **Drop the file.** Priya opens Featherbase and drops `employees.csv` on the page.
2. **See what Featherbase understood.** A preview appears: a Table called "Employees", 24 rows, seven Columns.
   Featherbase has worked out that joining and leaving dates are Dates, Active is Yes/No, Weekly Hours is a
   Number, and Department is a Choice of five values. It suggests Employee Code as the key.
3. **Confirm.** She changes nothing and presses Create.
4. **Browse.** The Employees list opens: the first 10 of 24 people, with the next page a click away.
5. **Open one.** She clicks Asha Raman. A form shows her seven values, and where the row came from:
   `employees.csv`, row 2.
6. **Change one.** She moves Asha from Sales to Billing, choosing from the five departments, and saves. The list
   shows Billing.
7. **The original is safe.** She downloads the uploaded file again; it is exactly what she dropped.

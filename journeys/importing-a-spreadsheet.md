# Journey: importing a spreadsheet

An employee list in a spreadsheet becomes a working Table in two minutes.

The file is `samples/employees/employees.csv`.

1. Open Featherbase and choose "Import data".
2. Give it `employees.csv`.
3. Featherbase shows the Table it would make: Table name "Employees", 24 rows, 7 Columns.

   | Column | Type | Key |
   |---|---|---|
   | Employee Code | Text | suggested |
   | Name | Text | |
   | Department | Choice (5 values) | |
   | Date of Joining | Date | |
   | Date of Leaving | Date | |
   | Active | Yes/No | |
   | Weekly Hours | Number | |

4. Press Create without changing anything.
5. The Employees list opens. It says "1 to 10 of 24", shows the file's first 10 rows, and has "Next" for the
   rest.

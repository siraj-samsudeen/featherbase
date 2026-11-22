# Journey: importing a spreadsheet

An employee list in a spreadsheet becomes a working Table in two minutes.

The file is `samples/employees/employees.csv`.

1. Open Featherbase and choose "Import Data".
2. Give it `employees.csv`.
3. Featherbase shows the Table it would make: Table name "Employees", 24 rows and 7 columns.

   | Column | Type | Key |
   |---|---|---|
   | Employee Code | Text | suggested |
   | Name | Text | |
   | Department | Choice (5 values) | |
   | Date of Joining | Date | |
   | Date of Leaving | Date | |
   | Active | Yes/No | |
   | Weekly Hours | Number | |

4. Press Create Table without changing anything.
5. The Employees list opens. It says "1 to 10 of 24", shows the file's first 10 rows, and has "Next" for the
   rest.

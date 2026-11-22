# Journey: importing a spreadsheet

An employee list in a spreadsheet becomes a working Table in two minutes.

The file is `samples/employees/employees.csv`.

1. Open Featherbase and choose "Import Data".
2. Give it `employees.csv`.
3. Featherbase shows the Table it would make: Table name "Employees", 24 rows and 7 columns.

   | Column | Type | Key | In the first row |
   |---|---|---|---|
   | Employee Code | Text | key | E0007 |
   | Name | Text | | Asha Raman |
   | Department | Choice | | Sales |
   | Date of Joining | Date | | 01-Jan-2015 |
   | Date of Leaving | Date | | — |
   | Active | Yes/No | | Yes |
   | Weekly Hours | Number | | 48 |

4. Press Create Table without changing anything.
5. The Employees list opens with all 24 rows. The first row reads as the last column of the table above.

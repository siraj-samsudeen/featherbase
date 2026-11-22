import { bar, homeCrumb } from "../../../page.ts";

export const importDataView = {
  title: "Import Data",
  html: `
    <section class="view">
      ${bar("Import Data", [homeCrumb, { name: "Import Data" }])}
      <div class="page">
        <form class="drop" method="post" enctype="multipart/form-data">
          <strong>Choose a CSV file</strong>
          <p>The first row must hold the column names.</p>
          <div class="btns">
            <label class="btn primary">Choose a file
              <input type="file" name="file" accept=".csv,text/csv" hidden onchange="this.form.submit()">
            </label>
          </div>
        </form>
        <ol class="steps">
          <li><b>Featherbase proposes a Table</b>A name, a type for each Column, and a key.</li>
          <li><b>You decide</b>Nothing is created until you press Create.</li>
        </ol>
      </div>
    </section>`,
};

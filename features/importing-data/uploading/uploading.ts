import { bar, homeCrumb } from "../../../page.ts";

export const sampleAddress = "/import/sample";
export const sampleName = "employees.csv";
export const sampleFile = `${import.meta.dir}/../../../samples/employees/${sampleName}`;

export const importDataView = {
  title: "Import Data",
  html: `
    <section class="view">
      ${bar("Import Data", [homeCrumb, { name: "Import Data" }])}
      <div class="page">
        <form class="drop" method="post" enctype="multipart/form-data"
          ondragover="event.preventDefault(); this.classList.add('over')"
          ondragleave="this.classList.remove('over')"
          ondrop="event.preventDefault(); this.elements.file.files = event.dataTransfer.files; this.submit()">
          <strong>Drop A CSV File Here</strong>
          <p>The first row must hold the column names.</p>
          <div class="btns">
            <label class="btn primary">Choose a file
              <input type="file" name="file" accept=".csv,text/csv" hidden onchange="this.form.submit()">
            </label>
            <button type="submit" class="btn" formaction="${sampleAddress}">Try the sample: ${sampleName}</button>
          </div>
        </form>
        <ol class="steps">
          <li><b>The file is kept</b>Exactly as you gave it, so nothing is lost.</li>
          <li><b>Featherbase proposes a Table</b>A name, a type for each Column, and a key.</li>
          <li><b>You decide</b>Nothing is created until you press Create.</li>
        </ol>
      </div>
    </section>`,
};

// backend/utils/p9aGenerator.js
import PdfPrinter from "pdfmake";
import fs from "fs";
import path from "path";

function formatCurrency(amount) {
  const num = parseFloat(amount);
  if (isNaN(num) || num === null || num === undefined) return "0.00";
  return num.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const generateP9APDF = (monthlyPayrollData, employee, company, year) => {
  return new Promise(async (resolve, reject) => {
    try {
      const fonts = {
        Roboto: {
          normal: "Helvetica",
          bold: "Helvetica-Bold",
          italics: "Helvetica-Oblique",
          bolditalics: "Helvetica-BoldOblique",
        },
      };

      const printer = new PdfPrinter(fonts);

      // Ensure logo exists
      const logoPath = path.join(process.cwd(), "assets/images/kra_logo.png");
      let logo = null;
      if (fs.existsSync(logoPath)) {
        logo = logoPath;
      }

      // --- Header ---
      const headerContent = [
        
        {
          image: logo || "assets/images/placeholder_logo.png",
          width: 250,
          alignment: "center",
          margin: [0, 5, 0, 5],
        },
        { text: "DOMESTIC TAXES DEPARTMENT", style: "title", alignment: "center" },
        { text: `TAX DEDUCTION CARD YEAR: ${year}`, style: "header" },
        {
          columns: [
            { text: "P9A", style: "kra", alignment: "left" },
          ],
        },
        {
          columns: [
            [
              {
                text: `Employer's Name: ${company.business_name || "N/A"}`,
                style: "info",
              },
              {
                text: `Employer's PIN: ${company.kra_pin || "N/A"}`,
                style: "info",
              },
            ],
            [
              {
                text: `Employee's Other Names: ${employee.first_name} ${
                  employee.other_names || ""
                }`,
                style: "info",
                alignment: "right",
              },
              {
                text: `Employee's Main Name: ${employee.last_name}`,
                style: "info",
                alignment: "right",
              },
              {
                text: `Employee's PIN: ${employee.krapin || "N/A"}`,
                style: "info",
                alignment: "right",
              },
            ],
          ],
          margin: [0, 10, 0, 10],
        },
      ];

      // --- Months list ---
      const months = [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December",
      ];

      const sortedData = monthlyPayrollData.sort(
        (a, b) =>
          months.indexOf(a.payroll_run.payroll_month) -
          months.indexOf(b.payroll_run.payroll_month)
      );

      // --- Totals accumulator ---
      let totals = {
        salary: 0, benefits: 0, gross: 0,
        e1: 0, e2: 0, e3: 0, f: 0, g: 0,
        h: 0, j: 0, k: 0, l: 0,
      };

      // --- Table header rows ---
      const tableBody = [
        [
          { text: "MONTH", rowSpan: 1, style: "tableHeader" },
          { text: "Basic Salary\nKshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Benefits\nNon-Cash\nKshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Value of\nQuarters\nKshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Total Gross\nPay Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Defined Contribution Retirement", colSpan: 3, style: "tableHeader" }, {}, {},
          { text: "Owner-\nOccupied\nInterest\nKshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Retirement\nContribution &\nOwner\nOccupied\nInterest Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Chargeable\nPay Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Tax\nCharged\nKshs.", rowSpan: 1, style: "tableHeader" },
          { text: "Personal\nRelief +\nInsurance\nRelief Kshs.", rowSpan: 1, style: "tableHeader" },
          { text: "PAYE Tax\n(J-K) Kshs.", rowSpan: 1, style: "tableHeader" },
        ],
        [
          { text : "", rowSpan: 2,},{text : "A", rowSpan: 2, style: "tableHeader"},
          {text : "B", rowSpan: 2, style: "tableHeader"},
          {text : "C", rowSpan: 2, style: "tableHeader"},
          {text : "D", rowSpan: 2, style: "tableHeader"},
          {text : "E", colSpan: 3, style: "tableHeader"}, {}, {},
          {text : "F\n Amount of\nInterest", rowSpan: 2, style: "tableHeader"},
          {text : "G\nThe lowest\nof E added to\nF", rowSpan: 2, style: "tableHeader"},
          {text : "H", rowSpan: 2, style: "tableHeader"},
          {text : "J", rowSpan: 2, style: "tableHeader"},
          {text : "K", style: "tableHeader"},
          {text : "L", rowSpan: 2, style: "tableHeader"}
        ],
        [
          {},{},{},{},{},
          { text: "E1\n30% of A", style: "tableHeader" },
          { text: "E2\nActual", style: "tableHeader" },
          { text: "E3\nFixed", style: "tableHeader" },
          {},{},{},{},{text: "Total\nKshs.", style: "tableHeader"},{}
        ],
      ];

      // --- Table data rows ---
      sortedData.forEach((m) => {
        const salary = m.basic_salary || 0;
        const benefits = (m.total_non_cash_benefits + m.total_allowances) || 0;
        const gross = m.gross_pay || 0;
        const e1 = salary * 0.3;
        const e2 = m.nssf_deduction || 0;
        const e3 = 30000;
        const f = 0;
        const g = Math.min(e1, e2, e3) + f;
        const h = m.taxable_income || 0;
        const j = (m.paye_tax + 2400) || 0;
        const k = 2400;
        const l = Math.max(0, j - k);

        totals.salary += salary;
        totals.benefits += benefits;
        totals.gross += gross;
        totals.e1 += e1; totals.e2 += e2; totals.e3 += e3;
        totals.g += g; totals.h += h;
        totals.j += j; totals.k += k; totals.l += l;

        tableBody.push([
          { text: m.payroll_run.payroll_month.toUpperCase(), alignment: "left" },
          { text: formatCurrency(salary), alignment: "right" },
          { text: formatCurrency(benefits), alignment: "right" },
          { text: "0.00", alignment: "right" },
          { text: formatCurrency(gross), alignment: "right" },
          { text: formatCurrency(e1), alignment: "right" },
          { text: formatCurrency(e2), alignment: "right" },
          { text: formatCurrency(e3), alignment: "right" },
          { text: formatCurrency(f), alignment: "right" },
          { text: formatCurrency(g), alignment: "right" },
          { text: formatCurrency(h), alignment: "right" },
          { text: formatCurrency(j), alignment: "right" },
          { text: formatCurrency(k), alignment: "right" },
          { text: formatCurrency(l), alignment: "right" },
        ]);
      });

      // Totals row
      tableBody.push([
        { text: "TOTALS", bold: true, alignment: "left" },
        { text: formatCurrency(totals.salary), bold: true, alignment: "right" },
        { text: formatCurrency(totals.benefits), bold: true, alignment: "right" },
        { text: "0.00", bold: true, alignment: "right" },
        { text: formatCurrency(totals.gross), bold: true, alignment: "right" },
        { text: formatCurrency(totals.e1), bold: true, alignment: "right" },
        { text: formatCurrency(totals.e2), bold: true, alignment: "right" },
        { text: formatCurrency(totals.e3), bold: true, alignment: "right" },
        { text: "0.00", bold: true, alignment: "right" },
        { text: formatCurrency(totals.g), bold: true, alignment: "right" },
        { text: formatCurrency(totals.h), bold: true, alignment: "right" },
        { text: formatCurrency(totals.j), bold: true, alignment: "right" },
        { text: formatCurrency(totals.k), bold: true, alignment: "right" },
        { text: formatCurrency(totals.l), bold: true, alignment: "right" },
      ]);

      // --- End of year section ---
      const endOfYear = {
        columns: [
          [
            { text: "To be completed by Employer at end of year", style: "subheader" },
            { text: `TOTAL CHARGEABLE PAY (COL. H) Kshs. ${formatCurrency(totals.h)}`, style: "info" },
            { text: "\n\n" },
            { text: "IMPORTANT", bold: true },
            {
              text: "1. Use P9A (a) For all liable employees and where director/employee received Benefits in addition to cash emoluments.\n(b) Where an employee is eligible to deduction on owner occupier interest.",
              style: "small", margin: [0, 5, 0, 0]
            },
            {
              text: "2. (a) Allowable interest in respect of any month must not exceed Kshs. 12,500/= or Kshs. 150,000 per year.\n(See back of this card for further information required by the Department).",
              style: "small", margin: [0, 5, 0, 0]
            },
            {
              text: "(b) Attach (i) Photostat copy of interest certificate and statement of account from the Financial Institution.\n(ii) The DECLARATION duly signed by the employee.",
              style: "small", margin: [0, 5, 0, 0]
            },
          ],
          [
            { text: `TOTAL TAX (COL. L) Kshs. ${formatCurrency(totals.l)}`, style: "info" },
            { text: "\n\n" },
            { text: "NAMES OF FINANCIAL INSTITUTION ADVANCING MORTGAGE LOAN:", style: "small", margin: [0, 10, 0, 0] },
            { text: "LR NO. OF OWNER OCCUPIED PROPERTY:....................", style: "small", margin: [0, 10, 0, 0] },
            { text: "DATE OF OCCUPATION OF HOUSE:....................", style: "small",margin: [0, 10, 0, 0] },
          ],
        ],
      };

      // --- Doc Definition ---
      const docDefinition = {
        pageOrientation: "landscape",
        pageSize: "A4",
        content: [
          ...headerContent,
          {
            table: {
              headerRows: 3,
              body: tableBody,
              widths: [
                "auto","*","*","*","*","*","*","*","*","*","*","*","*","*",
              ],
            },
            fontSize: 7,
            layout: {
              hLineWidth: () => 0.5,
              vLineWidth: () => 0.5,
              hLineColor: () => "black",
              vLineColor: () => "black",
            },
          },
          { text: "\n" },
          endOfYear,
        ],
        styles: {
          title: { fontSize: 16, bold: true },
          kra: { fontSize: 9, bold: true },
          header: { fontSize: 11, bold: true, alignment: "center" },
          subheader: { fontSize: 9, bold: true, margin: [0, 10, 0, 5] },
          info: { fontSize: 8, margin: [0, 2, 0, 2] },
          small: { fontSize: 7 },
          tableHeader: { bold: true, alignment: "center", margin: [0, 5, 0, 5] },
        },
      };

      // Generate PDF
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      pdfDoc.on("data", (chunk) => chunks.push(chunk));
      pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
      pdfDoc.end();
    } catch (err) {
      reject(err);
    }
  });
};

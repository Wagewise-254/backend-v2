// backend/controllers/reportsController.js
import supabase from "../libs/supabaseClient.js";
import { Parser } from "json2csv";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify";
import fetch from "node-fetch";

// Helper function to fetch payroll details for a given run
const fetchPayrollData = async (companyId, runId) => {
  const { data, error } = await supabase
    .from("payroll_details")
    .select(
      `
            *,
            employee:employee_id (
                first_name,
                last_name,
                other_names,
                phone,
                employee_number,
                krapin,
                nssf_number,
                shif_number,
                id_number,
                citizenship,
                employee_type,
                has_disability
            ),
            payroll_run:payroll_run_id (
                payroll_number
            )
        `
    )
    .eq("payroll_run_id", runId);

  if (error) {
    throw new Error("Failed to fetch payroll data.");
  }

  // Security check: ensure the payroll run belongs to the company
  const { data: runData, error: runError } = await supabase
    .from("payroll_runs")
    .select("company_id")
    .eq("id", runId)
    .single();
  if (runError || runData.company_id !== companyId) {
    throw new Error("Unauthorized access to payroll run.");
  }

  return data;
};

// Helper function to fetch company details
const fetchCompanyDetails = async (companyId) => {
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .single();
  if (error) {
    throw new Error("Failed to fetch company details.");
  }
  return data;
};

// Helper functions for each file type here
export const generateReport = async (req, res) => {
  const { companyId, runId, reportType } = req.params;

  if (!companyId || !runId || !reportType) {
    return res.status(400).json({ error: "Missing required parameters." });
  }

  try {
    const payrollData = await fetchPayrollData(companyId, runId);
    let companyDetails;
    if (reportType === "payroll-summary") {
      companyDetails = await fetchCompanyDetails(companyId);
    }

    switch (reportType) {
      case "kra-sec-b1":
        // Call KRA file generation logic
        const kraCsv = await generateKraSecB1(payrollData);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="KRA_SEC_B1_${runId}.csv"`
        );
        res.end(Buffer.from(kraCsv, "utf-8"));
        break;
      case "nssf-return":
        // Call NSSF file generation logic
        const nssfExcelBuffer = await generateNssfReturn(payrollData);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="NSSF_Return_${runId}.xlsx"`
        );
        res.send(nssfExcelBuffer);
        break;
      case "shif-return":
        const shifExcelBuffer = await generateShifReturn(payrollData);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="SHIF_Return_${runId}.xlsx"`
        );
        res.send(shifExcelBuffer);
        break;
      case "housing-levy-return":
        const housingLevyCsv = await generateHousingLevyReturn(payrollData);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="Housing_Levy_${runId}.csv"`
        );
        res.end(Buffer.from(housingLevyCsv, "utf-8"));
        break;
      case "helb-report":
        const helbExcelBuffer = await generateHelbReport(payrollData);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="HELB_Report_${runId}.xlsx"`
        );
        res.send(helbExcelBuffer);
        break;
      case "bank-payment":
        const bankCsv = await generateBankPaymentFile(payrollData);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="Bank_Payments_${runId}.csv"`
        );
        res.end(Buffer.from(bankCsv, "utf-8"));
        break;
      case "mpesa-payment":
        const mpesaCsv = await generateMpesaPaymentFile(payrollData);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="M-Pesa_Payments_${runId}.csv"`
        );
        res.end(Buffer.from(mpesaCsv, "utf-8"));
        break;
      case "cash-payment":
        const cashPdfBuffer = await generateCashPaymentSheet(payrollData);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="Cash_Sheet_${runId}.pdf"`
        );
        res.send(cashPdfBuffer);
        break;
      case "payroll-summary":
        const summaryExcelBuffer = await generateGenericExcelReport(
          payrollData,
          "Payroll Summary",
          companyDetails
        );
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="Payroll_Summary_${runId}.xlsx"`
        );
        res.send(summaryExcelBuffer);
        break;
      case "allowance-report":
        const allowanceExcelBuffer = await generateGenericExcelReport(
          payrollData,
          "Allowance Report"
        );
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="Allowance_Report_${runId}.xlsx"`
        );
        res.send(allowanceExcelBuffer);
        break;
      case "deduction-report":
        const deductionExcelBuffer = await generateGenericExcelReport(
          payrollData,
          "Deduction Report"
        );
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="Deduction_Report_${runId}.xlsx"`
        );
        res.send(deductionExcelBuffer);
        break;
      default:
        return res.status(404).json({ error: "Report type not found." });
    }
  } catch (err) {
    console.error("Error generating report:", err);
    res.status(500).json({ error: err.message || "Internal server error." });
  }
};

const formatCurrency = (amount) => {
  const num = parseFloat(amount);
  return isNaN(num) ? "0.00" : num.toFixed(2);
};

// Function to generate KRA SEC_B1 PAYE file (CSV)
const generateKraSecB1 = (data) => {
  // Define the fields for the CSV file. This acts as the header.
  const kraRecords = data.map((record) => {
    const allowancesString = record.allowances_details;
    let allowances = [];
    if (
      typeof allowancesString === "string" &&
      allowancesString.trim() !== ""
    ) {
      try {
        allowances = JSON.parse(allowancesString);
      } catch (e) {
        console.error(
          "Failed to parse allowances_details for record:",
          record.id,
          e
        );
      }
    }

    const getAllowanceValue = (name) => {
      const allowance = allowances.find((a) =>
        a.name.toLowerCase().includes(name.toLowerCase())
      );
      return allowance ? parseFloat(allowance.value) : 0;
    };

    const otherAllowances = allowances
      .filter(
        (a) =>
          ![
            "housing",
            "transport",
            "leave pay",
            "overtime",
            "director fee",
            "car benefit",
            "meals benefit",
          ].some((n) => a.name.toLowerCase().includes(n))
      )
      .reduce((sum, a) => sum + parseFloat(a.value), 0);

    let resident_status =
      record.employee.citizenship.toLowerCase() !== "kenyan"
        ? "Non-Resident"
        : "Resident";
    let EmployeeDisabilityStatus = record.employee.has_disability
      ? "Yes"
      : "No";

    return [
      record.employee.krapin || "",
      `${record.employee.first_name || ""} ${
        record.employee.other_names || ""
      } ${record.employee.last_name || ""}`.trim(),
      resident_status || "Resident",
      record.employee.employee_type || "Primary Employee",
      EmployeeDisabilityStatus,
      "", // remember to fill this field with exemption certificate number if any
      formatCurrency(record.basic_salary || 0),
      formatCurrency(getAllowanceValue("car benefit")),
      formatCurrency(getAllowanceValue("meals benefit")),
      formatCurrency(record.total_non_cash_benefits),
      "Benefit not given",
      formatCurrency(getAllowanceValue("housing")),
      formatCurrency(otherAllowances),
      "", // Blank
      formatCurrency(record.shif_deduction),
      formatCurrency(record.nssf_deduction),
      0.0, // other pension deductions not in payroll details
      0.0, // post retirement medical fund not in payroll details
      0.0, // mortgage interest not in payroll details
      formatCurrency(record.housing_levy_deduction),
      "", // Blank
      2400.0,
      record.insurance_relief || 0.0, // insurance relief not in payroll details
      "",
      formatCurrency(record.paye_tax),
    ];
  });
  return new Promise((resolve, reject) => {
    stringify(kraRecords, { header: false }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

// Function to generate NSSF Return file (Excel)
const generateNssfReturn = async (data) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("NSSF Return");

  const headers = [
    "Employee No.",
    "Surname",
    "Other names",
    "ID number",
    "KRA pin",
    "NSSF Number",
    "Gross Pay",
    "Voluntary",
  ];
  worksheet.addRow(headers);

  data.forEach((record) => {
    worksheet.addRow([
      record.employee.employee_number,
      record.employee.last_name,
      `${record.employee.first_name} ${
        record.employee.other_names || ""
      }`.trim(),
      record.employee.id_number,
      record.employee.krapin,
      record.employee.nssf_number,
      parseFloat(record.gross_pay),
      0, // Assuming voluntary is 0 for now
    ]);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

// ... (Add functions for other files)
const generateShifReturn = async (data) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("SHIF Return");
  const headers = [
    "Payroll number",
    "First Name",
    "Last Name",
    "ID number",
    "KRA pin",
    "SHIF number",
    "Contribution Amount",
    "Phone Number",
  ];
  worksheet.addRow(headers);
  data.forEach((record) => {
    worksheet.addRow([
      record.payroll_run.payroll_number,
      record.employee.first_name,
      record.employee.last_name,
      record.employee.id_number,
      record.employee.krapin,
      record.employee.shif_number,
      parseFloat(record.shif_deduction),
      record.employee.phone, // Assuming phone number is from employee record
    ]);
  });
  return await workbook.xlsx.writeBuffer();
};

const generateHousingLevyReturn = (data) => {
  const records = data.map((record) => [
    record.employee.id_number || "",
    `${record.employee.first_name || ""} ${record.employee.other_names || ""} ${
      record.employee.last_name || ""
    }`.trim(),
    record.employee.krapin || "",
    formatCurrency(record.housing_levy_deduction || 0),
  ]);
  return new Promise((resolve, reject) => {
    stringify(records, { header: false }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

const generateHelbReport = async (data) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("HELB Report");
  const headers = ["ID number", "Full Name", "Staff Number", "Amount Deducted"];
  worksheet.addRow(headers);
  data.forEach((record) => {
    if (parseFloat(record.helb_deduction) > 0) {
      worksheet.addRow([
        record.employee.id_number,
        `${record.employee.first_name} ${record.employee.other_names || ""} ${
          record.employee.last_name
        }`.trim(),
        record.employee.employee_number,
        parseFloat(record.helb_deduction),
      ]);
    }
  });
  return await workbook.xlsx.writeBuffer();
};

const generateBankPaymentFile = (data) => {
  const records = data
    .filter((r) => r.payment_method?.toLowerCase() === "bank")
    .map((record) => [
      `${record.employee.first_name} ${record.employee.other_names || ""} ${
        record.employee.last_name
      }`.trim(),
      record.account_name,
      // Bank code and branch code not in payroll_details, assuming these are placeholders
      "",
      "",
      formatCurrency(record.net_pay),
      `Payroll Ref ${record.payroll_run.payroll_number}`,
    ]);
  const columns = [
    "full names",
    "account number",
    "bank code",
    "branch code",
    "amount",
    "reference",
  ];
  return new Promise((resolve, reject) => {
    stringify(records, { header: true, columns: columns }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

const generateMpesaPaymentFile = (data) => {
  const records = data
    .filter((r) => r.payment_method?.toLowerCase() === "m-pesa")
    .map((record) => [
      `${record.employee.first_name} ${record.employee.other_names || ""} ${
        record.employee.last_name
      }`.trim(),
      record.mpesa_phone,
      formatCurrency(record.net_pay),
      `Payroll Ref ${record.payroll_run.payroll_number}`,
    ]);
  const columns = ["fullname", "mpesa phone number", "amount", "reference"];
  return new Promise((resolve, reject) => {
    stringify(records, { header: true, columns: columns }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
};

const generateCashPaymentSheet = async (data) => {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
    });
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    doc.fontSize(12).text("Cash Payment Sheet", { align: "center" });
    doc.moveDown();

    const tableTop = doc.y;
    const table = {
      headers: ["No.", "Full Name", "ID Number", "Net Pay (KSh)", "Signature"],
      rows: data
        .filter((r) => r.payment_method?.toLowerCase() === "cash")
        .map((record, index) => [
          (index + 1).toString(),
          `${record.employee.first_name} ${record.employee.other_names || ""} ${
            record.employee.last_name
          }`.trim(),
          record.employee.id_number,
          formatCurrency(record.net_pay),
          "", // Blank for signature
        ]),
    };

    const tableWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = tableWidth / table.headers.length;

    // Draw headers
    doc.font("Helvetica-Bold").fontSize(10);
    let currentX = doc.page.margins.left;
    table.headers.forEach((header) => {
      doc.text(header, currentX, tableTop, {
        width: colWidth,
        align: "center",
      });
      currentX += colWidth;
    });

    // Draw rows
    doc.font("Helvetica").fontSize(9);
    let currentY = tableTop + 20;
    table.rows.forEach((row) => {
      currentX = doc.page.margins.left;
      row.forEach((cell) => {
        doc.text(cell, currentX, currentY, {
          width: colWidth,
          align: "center",
        });
        currentX += colWidth;
      });
      currentY += 20;
    });

    doc.end();
  });
};

// Generic report generation (Payroll Summary, Allowance, Deduction)
const generateGenericExcelReport = async (data, reportType, companyDetails) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(reportType);
  let headers;

  if (reportType === "Payroll Summary") {
    // Check if data is available to prevent errors on empty reports
    if (!data || data.length === 0) {
      return await workbook.xlsx.writeBuffer();
    }
    //  Get payroll details for the title
    const firstRecord = data[0];
    const payrollNumber = firstRecord.payroll_run?.payroll_number || "N/A";
    const payrollMonth = new Date(
      `${payrollNumber.split("-")[1].substring(4, 6)}/01/${payrollNumber
        .split("-")[1]
        .substring(0, 4)}`
    ).toLocaleString("default", { month: "long" });
    const payrollYear = payrollNumber.split("-")[1].substring(0, 4);

    //  --------- Header Section (Row 1-5) ------------

    // 1. Merge cells for the header section
    worksheet.mergeCells("A1:K5");

    // 2. Combine all header text into a single value for the merged cell A1
    const mainTitle = `MONTHLY PAYROLL SUMMARY: ${payrollMonth.toUpperCase()} ${payrollYear}`;
    const departmentInfo = "DEPARTMENT: ALL";

    // Set the value of the merged cell. Use newlines for formatting.
    const mergedCell = worksheet.getCell('A1');
    mergedCell.value = `${companyDetails?.business_name?.toUpperCase() || 'YOUR COMPANY'}\n${mainTitle}\n${departmentInfo}`;

    // Apply styles to the merged cell
    mergedCell.font = {
      bold: true,
      size: 14
    };
    mergedCell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true
    };
    mergedCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFFFF' }, // White background
    };
    mergedCell.border = {
      top: { style: 'none' },
      left: { style: 'none' },
      bottom: { style: 'none' },
      right: { style: 'none' },
    };
    // 1. Company Logo
    const logoUrl = companyDetails?.logo_url;
    if (logoUrl) {
      try {
        const logoResponse = await fetch(logoUrl);
        const logoBuffer = await logoResponse.buffer();
        const logoImage = workbook.addImage({
          buffer: logoBuffer,
          extension: "jpeg",
        });
        worksheet.addImage(logoImage, {
          tl: { col: 1, row: 1 },
          ext: { width: 60, height: 60 },
        });
      } catch (e) {
        console.error("Failed to add logo:", e);
      }
    }

    // Space after header
    const dataStartRow = 6;

    //detemine unique allowance and deduction types
    // Determine unique allowance and deduction types
    const uniqueAllowances = new Set();
    const uniqueDeductions = new Set();

    data.forEach((record) => {
      const allowances = record.allowances_details || [];
      const deductions = record.deductions_details || [];
      if (Array.isArray(allowances)) {
        allowances.forEach((a) => uniqueAllowances.add(a.name));
      }
      if (Array.isArray(deductions)) {
        deductions.forEach((d) => uniqueDeductions.add(d.name));
      }
    });

    const allowanceNames = Array.from(uniqueAllowances).sort();
    const deductionNames = Array.from(uniqueDeductions).sort();

    // 4. Define headers
    const fixedHeadersBeforeAllowances = ["EMP. No.", "NAME", "BASIC PAY"];
    const fixedHeadersAfterAllowances = [
      "GROSS PAY",
      "PAYE",
      "NSSF",
      "SHIF",
      "HOUSING LEVY",
    ];
    const fixedHeadersAfterDeductions = ["TOTAL DED.", "NET PAY (KSH.)"];

    headers = [
      ...fixedHeadersBeforeAllowances,
      ...allowanceNames.map((name) => name.toUpperCase()),
      ...fixedHeadersAfterAllowances,
      ...deductionNames.map((name) => name.toUpperCase()),
      ...fixedHeadersAfterDeductions,
    ];

    worksheet.addRow(headers).eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center" };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF0F0F0" }, // Light gray background
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // 5. Populate data rows and calculate totals
    const totals = new Array(headers.length).fill(0);
    const totalsMapping = {
      "EMP. No.": "ignore",
      NAME: "ignore",
      "BASIC PAY": "basic_salary",
      "GROSS PAY": "gross_pay",
      PAYE: "paye_tax",
      NSSF: "nssf_deduction",
      SHIF: "shif_deduction",
      "HOUSING LEVY": "housing_levy_deduction",
      "TOTAL DED.": "total_deductions",
      "NET PAY (KSH.)": "net_pay",
    };

    data.forEach((record) => {
      const rowData = {};
      const allowances = Array.isArray(record.allowances_details)
        ? record.allowances_details
        : JSON.parse(record.allowances_details || "[]");
      const deductions = Array.isArray(record.deductions_details)
        ? record.deductions_details
        : JSON.parse(record.deductions_details || "[]");

      // Map dynamic allowances to rowData
      allowanceNames.forEach((name) => {
        const allowance = allowances.find((a) => a.name === name);
        rowData[name.toUpperCase()] = parseFloat(allowance?.value || 0);
      });

      // Map dynamic deductions to rowData
      deductionNames.forEach((name) => {
        const deduction = deductions.find((d) => d.name === name);
        rowData[name.toUpperCase()] = parseFloat(deduction?.value || 0);
      });

      // Construct the row array in the correct order
      const row = [];
      headers.forEach((header) => {
        if (header === "EMP. No.") {
          row.push(record.employee?.employee_number || "");
        } else if (header === "NAME") {
          row.push(
            `${record.employee?.first_name || ""} ${
              record.employee?.last_name || ""
            }`
          );
        } else if (totalsMapping[header]) {
          row.push(parseFloat(record[totalsMapping[header]] || 0));
        } else {
          row.push(rowData[header] || 0);
        }
      });
      worksheet.addRow(row);

      // Calculate totals
      row.forEach((value, index) => {
        if (index > 1 && !isNaN(parseFloat(value))) {
          totals[index] += parseFloat(value);
        }
      });
    });

    // 6. Add the totals row
    const totalsRow = ["", "TOTALS", ...totals.slice(2)];
    worksheet.addRow(totalsRow).eachCell((cell) => {
      cell.font = { bold: true };
    });

    // 7. Apply number formatting
    worksheet.columns.forEach((column, index) => {
      if (index > 1) {
        // Apply to all columns except EMP. No. and NAME
        column.numFmt = "#,##0.00";
      }
    });

    // 8. Adjust column widths
    worksheet.columns.forEach((column) => {
      const header = column.header;
      let maxLength = 0;
      if (header) {
        maxLength = header.toString().length;
      }
      column.eachCell({ includeEmpty: true }, (cell) => {
        const cellLength = cell.value ? cell.value.toString().length : 0;
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      column.width = Math.max(10, Math.min(15, maxLength + 2));
    });

    // ---------- Footer Section ----------

    const lastRow = worksheet.lastRow.number + 3;
    const preparedByCell = worksheet.getCell(`B${lastRow}`);
    preparedByCell.value =
      "PREPARED BY: .......................................";
    const checkedByCell = worksheet.getCell(`E${lastRow}`);
    checkedByCell.value =
      "CHECKED BY: ........................................";
    const preparedDateCell = worksheet.getCell(`B${lastRow + 1}`);
    preparedDateCell.value =
      "DATE: ...............................................";
    const checkedDateCell = worksheet.getCell(`E${lastRow + 1}`);
    checkedDateCell.value =
      "DATE: .................................................";
    worksheet.mergeCells(`B${lastRow}:D${lastRow}`);
    worksheet.mergeCells(
      `E${lastRow}:${String.fromCharCode(
        70 + headers.length - 1 - 4
      )}${lastRow}`
    );
    worksheet.mergeCells(`B${lastRow + 1}:D${lastRow + 1}`);
    worksheet.mergeCells(
      `E${lastRow + 1}:${String.fromCharCode(70 + headers.length - 1 - 4)}${
        lastRow + 1
      }`
    );
  } else if (reportType === "Allowance Report") {
    //console.log(data)
    headers = ["Employee No", "Full Name", "Allowance Name", "Amount"];
    worksheet.addRow(headers);
    data.forEach((record) => {
      const allowances = record.allowances_details || [];
      if (Array.isArray(allowances)) {
        allowances.forEach((allowance) => {
          worksheet.addRow([
            record.employee.employee_number,
            `${record.employee.first_name} ${record.employee.last_name}`,
            allowance.name,
            parseFloat(allowance.value),
          ]);
        });
      }
    });
  } else if (reportType === "Deduction Report") {
    //console.log(data);
    headers = ["Employee No", "Full Name", "Deduction Name", "Amount"];
    worksheet.addRow(headers);
    data.forEach((record) => {
      const deductions = record.deductions_details || [];
      if (Array.isArray(deductions)) {
        deductions.forEach((deduction) => {
          worksheet.addRow([
            record.employee.employee_number,
            `${record.employee.first_name} ${record.employee.last_name}`,
            deduction.name,
            parseFloat(deduction.value),
          ]);
        });
      }
    });
  }

  return await workbook.xlsx.writeBuffer();
};

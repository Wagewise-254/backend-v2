// backend/controllers/reportsController.js
import supabase from "../libs/supabaseClient.js";
import { Parser } from "json2csv";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { stringify } from "csv-stringify";

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

// ... (Add all the helper functions for each file type here)

export const generateReport = async (req, res) => {
  const { companyId, runId, reportType } = req.params;

  if (!companyId || !runId || !reportType) {
    return res.status(400).json({ error: "Missing required parameters." });
  }

  try {
    const payrollData = await fetchPayrollData(companyId, runId);

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
          "Payroll Summary"
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
      0, // insurance relief not in payroll details
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
    "Payroll number",
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
      record.payroll_run.payroll_number,
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
const generateGenericExcelReport = async (data, reportType) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(reportType);
  let headers;

  if (reportType === "Payroll Summary") {
    // 1. Get payroll details for the title
    const firstRecord = data[0];
    // Check if data is available to prevent errors on empty reports
    if (!firstRecord || !firstRecord.payroll_run) {
      return await workbook.xlsx.writeBuffer();
    }
   const payrollMonth = new Date(
      `${firstRecord.payroll_run.payroll_number.split('-')[1].substring(4, 6)}/01/${firstRecord.payroll_run.payroll_number.split('-')[1].substring(0, 4)}`
    ).toLocaleString('default', { month: 'long' });
    const payrollYear = firstRecord.payroll_run.payroll_number.split('-')[1].substring(0, 4);

    // 2. Add the title
    worksheet.mergeCells("A1:M1");
    worksheet.getCell(
      "A1"
    ).value = `MONTHLY PAYROLL SUMMARY: ${payrollMonth.toUpperCase()} ${payrollYear}`;
    worksheet.getCell("A1").font = { bold: true, size: 14 };
    worksheet.getCell("A1").alignment = { horizontal: "center" };
    worksheet.addRow([]); // Blank row for spacing

    //3. Define headers
    headers = [
      "EMP. NUMBER",
      "NAME",
      "BASIC PAY",
      "HOUSE ALL.",
      "OVERTIME",
      "OTHER ALLOWANCES",
      "GROSS PAY",
      "PAYE",
      "NSSF",
      "SHIF",
      "HELB",
      "ADVANCE",
      "OTHER DED.",
      "TOTAL DED.",
      "NET PAY (KSH.)",
    ];
    worksheet.addRow(headers).eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center" };
       cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF0F0F0' } // Light gray background
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    let totalBasicPay = 0;
    let totalHouseAll = 0;
    let totalOT = 0;
    let totalOtherAllowances = 0;
    let totalGrossPay = 0;
    let totalPaye = 0;
    let totalNssf = 0;
    let totalShif = 0;
    let totalHelb = 0;
    let totalAdvance = 0;
    let totalOtherDeductions = 0;
    let totalDeductions = 0;
    let totalNetPay = 0;

    // 4. populate data rows and calculate totals
    data.forEach((record) => {
      let housingAllowance = 0;
      let overtime = 0;
      let otherAllowances = 0;
      let advanceDeduction = 0;
      let otherDeductions = 0;
      let totalCustomDeductions = 0;
      // Helper function to extract allowance value
      const allowances = record.allowances_details || [];
      if (Array.isArray(allowances)) {
        allowances.forEach((allowance) => {
          if (allowance.name?.toLowerCase().includes("housing")) {
            housingAllowance += parseFloat(allowance.value);
          } else if (allowance.name?.toLowerCase().includes("overtime")) {
            overtime += parseFloat(allowance.value);
          } else {
            otherAllowances += parseFloat(allowance.value);
          }
        });
      }

      // Helper function to extract deduction value
      const deductions = record.deductions_details || [];
      if (Array.isArray(deductions)) {
        deductions.forEach((deduction) => {
          if (deduction.name?.toLowerCase().includes("advance")) {
            advanceDeduction += parseFloat(deduction.value);
          } else {
            otherDeductions += parseFloat(deduction.value);
          }
        });
      }

      //const housingAllowance = getAllowanceValue("housing");
      //const overtime = getAllowanceValue("overtime");
      //const otherAllowances = parseFloat(record.total_allowances) - housingAllowance - overtime;
      //const helbDeduction = getDeductionValue("helb");
      //const otherDeductions = (parseFloat(record.total_deductions) - parseFloat(record.total_statutory_deductions)) - helbDeduction;

      worksheet.addRow([
        record.employee.employee_number,
        `${record.employee.first_name} ${record.employee.last_name}`,
        parseFloat(record.basic_salary),
        housingAllowance,
        overtime,
        otherAllowances,
         parseFloat(record.gross_pay),
        parseFloat(record.paye_tax),
        parseFloat(record.nssf_deduction),
        parseFloat(record.shif_deduction),
        parseFloat(record.helb_deduction),
        advanceDeduction,
        otherDeductions,
        parseFloat(record.total_deductions),
        parseFloat(record.net_pay),
      ]);

      // Sum up totals
      totalBasicPay += parseFloat(record.basic_salary);
      totalHouseAll += housingAllowance;
      totalOT += overtime;
      totalOtherAllowances += otherAllowances;
      totalGrossPay += parseFloat(record.gross_pay);
      totalPaye += parseFloat(record.paye_tax);
      totalNssf += parseFloat(record.nssf_deduction);
      totalShif += parseFloat(record.shif_deduction);
      totalHelb += parseFloat(record.helb_deduction);
      totalAdvance += advanceDeduction;
      totalOtherDeductions += otherDeductions;
      totalDeductions += parseFloat(record.total_deductions);
      totalNetPay += parseFloat(record.net_pay);
    });

     // 5. Add the totals row
    worksheet.addRow([
      "",
      "TOTALS",
      totalBasicPay,
      totalHouseAll,
      totalOT,
      totalOtherAllowances,
      totalGrossPay,
      totalPaye,
      totalNssf,
      totalShif,
      totalHelb,
      totalAdvance,
      totalOtherDeductions,
      totalDeductions,
      totalNetPay,
    ]).eachCell(cell => {
      cell.font = { bold: true };
    });

    worksheet.addRow([]); // Blank row for spacing
    worksheet.addRow([]); // Blank row for spacing

    // 6. Add payment summary section
    const totalEmployees = data.length;
    const totalCashPayment = data.filter(d => d.payment_method?.toLowerCase() === "cash").reduce((sum, d) => sum + parseFloat(d.net_pay), 0);
    const totalBankPayment = data.filter(d => d.payment_method?.toLowerCase() === "bank").reduce((sum, d) => sum + parseFloat(d.net_pay), 0);
    const totalMpesaPayment = data.filter(d => d.payment_method?.toLowerCase() === "m-pesa").reduce((sum, d) => sum + parseFloat(d.net_pay), 0);
    const numCash = data.filter(d => d.payment_method?.toLowerCase() === "cash").length;
    const numBank = data.filter(d => d.payment_method?.toLowerCase() === "bank").length;
    const numMpesa = data.filter(d => d.payment_method?.toLowerCase() === "m-pesa").length;

     worksheet.addRow([`TOTAL NO. OF EMPLOYEES: ${totalEmployees}`]);
    worksheet.addRow([`TOTAL CASH PAYMENT: ${numCash} employees amounting to KSh. ${formatCurrency(totalCashPayment)}`]);
    worksheet.addRow([`TOTAL BANK PAYMENT: ${numBank} employees amounting to KSh. ${formatCurrency(totalBankPayment)}`]);
    worksheet.addRow([`TOTAL MPESA PAYMENT: ${numMpesa} employees amounting to KSh. ${formatCurrency(totalMpesaPayment)}`]);

    // Apply currency formatting to relevant columns
    const numberColumns = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
    numberColumns.forEach(col => {
      worksheet.getColumn(col).numFmt = '#,##0.00';
    });

    // Set fixed widths for key columns
    worksheet.getColumn('A').width = 12; // Emp Code
    worksheet.getColumn('B').width = 15;
    worksheet.columns.forEach((column) => {
      if (column.width < 12) {
        column.width = 12; // Minimum width for all other columns
      }
    });
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

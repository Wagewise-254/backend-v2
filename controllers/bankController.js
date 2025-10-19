// backend/controllers/bankController.js
import supabase from "../libs/supabaseClient.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import ExcelJS from "exceljs";
import pkg from "xlsx";
const { utils, read } = pkg;

// Path to the static banks JSON file
// Recreate __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const banksFilePath = path.join(__dirname, "../data/banks.json");

// Get all Kenyan bank data from the JSON file
export const getKenyanBanks = (req, res) => {
  try {
    const banksData = JSON.parse(fs.readFileSync(banksFilePath, "utf8"));
    res.status(200).json(banksData);
  } catch (error) {
    console.error("Failed to read banks.json:", error);
    res.status(500).json({ error: "Failed to retrieve bank data." });
  }
};

// Get all bank details for a specific employee
export const getEmployeeBankDetails = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;

  try {
    // Ownership check - simplified from previous controllers for brevity but still essential
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res
        .status(403)
        .json({ error: "Unauthorized to access this company's data." });
    }

    const { data, error } = await supabase
      .from("employee_bank_details")
      .select("*")
      .eq("employee_id", employeeId);

    if (error && error.code !== "PGRST116") {
      // Ignore "no rows found" error
      console.error("Fetch employee bank details error:", error);
      throw new Error("Failed to fetch employee bank details.");
    }

    res.status(200).json(data || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Add or update employee bank/M-Pesa details
export const updateEmployeeBankDetails = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;
  const {
    bank_name,
    bank_code,
    branch_name,
    branch_code,
    account_number,
    payment_method,
    phone_number,
  } = req.body;

  if (!payment_method) {
    return res.status(400).json({ error: "Payment method is required." });
  }

  try {
    // Ownership check
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res
        .status(403)
        .json({ error: "Unauthorized to modify this company's data." });
    }

    // Upsert operation to handle both adding and updating a single record
    const { data, error } = await supabase
      .from("employee_bank_details")
      .upsert(
        {
          employee_id: employeeId,
          bank_name: payment_method === "Bank" ? bank_name : null,
          bank_code: payment_method === "Bank" ? bank_code : null,
          branch_name: payment_method === "Bank" ? branch_name : null,
          branch_code: payment_method === "Bank" ? branch_code : null,
          account_number: payment_method === "Bank" ? account_number : null,
          phone_number: payment_method === "M-Pesa" ? phone_number : null,
          payment_method: payment_method,
        },
        { onConflict: "employee_id" }
      ) // Conflict on employee_id ensures one record per employee
      .select()
      .single();

    if (error) {
      console.error("Update employee bank details error:", error);
      throw new Error("Failed to update employee bank details.");
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete employee bank/M-Pesa details
export const deleteEmployeeBankDetails = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;

  try {
    // Ownership check
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res
        .status(403)
        .json({ error: "Unauthorized to delete this company's data." });
    }

    const { error } = await supabase
      .from("employee_bank_details")
      .delete()
      .eq("employee_id", employeeId);

    if (error) {
      console.error("Delete employee bank details error:", error);
      throw new Error("Failed to delete employee bank details.");
    }

    res.status(204).send(); // No content
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Generate an Excel template for bulk bank details import
export const generateBankDetailsTemplate = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res
        .status(403)
        .json({ error: "Unauthorized to access this company's data." });
    }

    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select("id, employee_number, first_name, last_name, other_names")
      .eq("company_id", companyId);

    if (employeesError) {
      throw new Error("Failed to fetch employee data.");
    }

    //sort employees by employee_number
    employees.sort((a, b) => {
      const codeA = a.employee_number || "";
      const codeB = b.employee_number || "";
      return codeA.localeCompare(codeB, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Bank Details Import");

    // Headers for the template
    const templateHeaders = [
      "Employee Number",
      "Employee Name",
      "Payment Method",
      "Bank Name",
      "Bank Code",
      "Branch Code",
      "Account Number",
      "Phone Number",
    ];

    // Add headers with a specific style
    const headerRow = worksheet.addRow(templateHeaders);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE6E6E6" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // Add dropdowns and data validation
    const paymentMethods = ["Bank", "M-Pesa", "Cash"];
    const dropdownOptions = {
      "Payment Method": paymentMethods,
    };

    headerRow.eachCell((cell, colNumber) => {
      const header = cell.value;
      if (dropdownOptions[header] && dropdownOptions[header].length > 0) {
        worksheet.dataValidations.add(
          `${worksheet.getColumn(colNumber).letter}2:${
            worksheet.getColumn(colNumber).letter
          }1000`,
          {
            type: "list",
            allowBlank: true,
            formulae: [`"${dropdownOptions[header].join(",")}"`],
          }
        );
      }
    });

    // Add employee data to the rows
    employees.forEach((employee) => {
      const employeeName = `${employee.first_name} ${employee.last_name} ${
        employee.other_names || ""
      }`.trim();
      const rowData = [
        employee.employee_number,
        employeeName,
        // Initial values for the user to fill
        null, // Payment Method
        null, // Bank Name
        null, // Bank Code
        null, // Branch Code
        null, // Account Number
        null, // Phone Number
      ];
      worksheet.addRow(rowData);
    });

    // Set column widths
    worksheet.columns.forEach((column, index) => {
      const header = templateHeaders[index];
      column.width = header.length < 15 ? 15 : header.length + 5;
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Employee_Bank_Details_Template.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Generate bank details template error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Import employee bank details from a spreadsheet
export const importBankDetails = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  try {
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res.status(403).json({
        error: "Unauthorized to import bank details to this company.",
      });
    }

    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select("id, employee_number")
      .eq("company_id", companyId);

    if (employeesError) {
      throw new Error("Failed to fetch employees for validation.");
    }

    const employeeNumberMap = employees.reduce((acc, emp) => {
      acc[emp.employee_number] = emp.id;
      return acc;
    }, {});

    const workbook = read(req.file.buffer, { type: "buffer" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
      defval: null,
    });

    const headers = jsonData[0].map((h) => h.trim());
    const bankDetailsToInsert = [];
    const errors = [];

    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;

      const bankData = {};
      headers.forEach((header, index) => {
        const key = header.replace(/\s/g, "_").toLowerCase();
        bankData[key] = row[index];
      });

      // Find employee ID using employee number
      const employeeNumber = bankData["employee_number"]?.toString();
      const employeeId = employeeNumberMap[employeeNumber];

      if (!employeeId) {
        errors.push(
          `Row ${i + 1}: Employee with number '${employeeNumber}' not found.`
        );
        continue;
      }

      const paymentMethod = bankData["payment_method"]?.trim();
      if (
        !paymentMethod ||
        !["Bank", "M-Pesa", "Cash"].includes(paymentMethod)
      ) {
        errors.push(`Row ${i + 1}: Invalid or missing 'Payment Method'.`);
        continue;
      }

      const record = {
        employee_id: employeeId,
        payment_method: paymentMethod,
        bank_name:
          paymentMethod === "Bank"
            ? bankData["bank_name"]
              ? String(bankData["bank_name"]).trim()
              : null
            : null,
        bank_code:
          paymentMethod === "Bank"
            ? bankData["bank_code"]
              ? String(bankData["bank_code"]).trim()
              : null
            : null,
        branch_code:
          paymentMethod === "Bank"
            ? bankData["branch_code"]
              ? String(bankData["branch_code"]).trim()
              : null
            : null,
        // bank_name is set to null if not bank
        branch_name: null,
        account_number:
          paymentMethod === "Bank"
            ? bankData["account_number"]
              ? String(bankData["account_number"]).trim()
              : null
            : null,
        phone_number:
          paymentMethod === "M-Pesa"
            ? bankData["phone_number"]
              ? String(bankData["phone_number"]).trim()
              : null
            : null,
      };

      bankDetailsToInsert.push(record);
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: "Import failed due to validation errors.",
        details: errors,
      });
    }

    // Use upsert to handle new entries and updates for existing ones
    const { data, error } = await supabase
      .from("employee_bank_details")
      .upsert(bankDetailsToInsert, { onConflict: "employee_id" })
      .select();

    if (error) {
      console.error("Bulk upsert bank details error:", error);
      return res
        .status(500)
        .json({ error: "Failed to import employee bank details." });
    }

    res.status(200).json({
      message: "Bank details imported successfully!",
      count: data.length,
    });
  } catch (error) {
    console.error("Import bank details controller error:", error);
    res.status(500).json({ error: error.message });
  }
};

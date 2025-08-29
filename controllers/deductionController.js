import supabase from '../libs/supabaseClient.js';
import ExcelJS from "exceljs";
import pkg from "xlsx";
const { utils, read, SSF } = pkg;

// -------------------- Helper Functions -------------------- //
// Helper function to check for company ownership
const checkCompanyOwnership = async (companyId, userId) => {
  const { data: company, error } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .eq("user_id", userId)
    .single();

  if (error || !company) {
    return false;
  }
  return true;
};

// Parse and validate date string (must be YYYY-MM-DD)
function parseDate(dateStr, row, fieldName, errors) {
  if (!dateStr) return null;

  // Accept string or Excel date serial number
  if (typeof dateStr === "number") {
    // Excel serial number -> JS Date
    const parsedDate = SSF.parse_date_code(dateStr);
    if (!parsedDate) {
      errors.push(`Row ${row}: Invalid date format for ${fieldName}.`);
      return null;
    }
    const jsDate = new Date(parsedDate.y, parsedDate.m - 1, parsedDate.d);
    return jsDate.toISOString().split("T")[0];
  }

  if (typeof dateStr === "string") {
    const regex = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD
    if (!regex.test(dateStr)) {
      errors.push(
        `Row ${row}: Invalid date format for ${fieldName}. Use YYYY-MM-DD.`
      );
      return null;
    }
    return new Date(dateStr).toISOString().split("T")[0];
  }

  errors.push(`Row ${row}: Could not parse date for ${fieldName}.`);
  return null;
}

// -------------------- Controller Functions -------------------- //
// ASSIGN
export const assignDeduction = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const { deduction_type_id, employee_id, department_id, value, calculation_type, is_one_time = false, start_date, end_date } = req.body;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to assign deduction for this company.' });
    }

    const { data, error } = await supabase
      .from('deductions')
      .insert([{ company_id: companyId, deduction_type_id, employee_id, department_id, value, calculation_type, is_one_time, start_date, end_date }])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign deduction' });
  }
};

// GET ALL
export const getDeductions = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to fetch deductions for this company.' });
    }

    const { data, error } = await supabase
      .from('deductions')
      .select('*, deduction_types(name, is_tax_deductible), employees(first_name, last_name), departments(name)')
      .eq('company_id', companyId);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch deductions' });
  }
};

// GET ONE
export const getDeductionById = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to access this deduction.' });
    }

    const { data, error } = await supabase.from('deductions')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(404).json({ error: 'Deduction not found' });
  }
};

// UPDATE
export const updateDeduction = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;
  const { value, calculation_type, start_date, end_date, is_active, is_one_time } = req.body;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to update this deduction.' });
    }

    const { data, error } = await supabase
      .from('deductions')
      .update({ value, calculation_type, start_date, end_date, is_active, is_one_time })
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update deduction' });
  }
};

// REMOVE
export const removeDeduction = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to remove this deduction.' });
    }

    const { error } = await supabase.from('deductions')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);
    if (error) throw error;
    res.json({ message: 'Deduction removed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove deduction' });
  }
};

// GENERATE TEMPLATE FOR BULK DEDUCTION IMPORT
export const generateDeductionTemplate = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res
        .status(403)
        .json({ error: "Unauthorized to generate template for this company." });
    }

    // Fetch required data from the database
    const { data: employees, error: employeeError } = await supabase
      .from("employees")
      .select("employee_number, first_name, last_name")
      .eq("company_id", companyId);
    if (employeeError) throw employeeError;

    const { data: deductionTypes, error: deductionTypeError } = await supabase
      .from("deduction_types")
      .select("name")
      .eq("company_id", companyId);
    if (deductionTypeError) throw deductionTypeError;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Deductions");

    const headers = [
      { header: "Employee Number", key: "employee_number", width: 20 },
      { header: "Deduction Name", key: "deduction_name", width: 20 },
      { header: "Value", key: "value", width: 15 },
      { header: "Calculation Type", key: "calculation_type", width: 20 },
      { header: "Is Active", key: "is_active", width: 15 },
      { header: "Is One-Time", key: "is_one_time", width: 15 },
      { header: "Start Date (YYYY-MM-DD)", key: "start_date", width: 25 },
      { header: "End Date (YYYY-MM-DD)", key: "end_date", width: 25 },
    ];

    worksheet.columns = headers;
    worksheet.getRow(1).font = { bold: true };

    // Set the date format for the date columns
    const startDateColumn = worksheet.getColumn("start_date");
    if (startDateColumn) {
      startDateColumn.numFmt = "yyyy-mm-dd";
    }
    const endDateColumn = worksheet.getColumn("end_date");
    if (endDateColumn) {
      endDateColumn.numFmt = "yyyy-mm-dd";
    }

    // Add dropdowns for 'Deduction Name', 'Calculation Type', 'Is Active', and 'Is One-Time'
    const deductionNames = deductionTypes.map((type) => type.name);
    const calculationTypes = ["Fixed", "Percentage"];
    const isTrueFalse = ["true", "false"];

    employees.forEach((employee) => {
      worksheet.addRow([employee.employee_number]);
    });

    // Add dropdowns to each cell in the relevant columns
    for (let i = 2; i <= 1000; i++) {
      worksheet.getCell(`B${i}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${deductionNames.join(",")}"`],
      };
      worksheet.getCell(`D${i}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${calculationTypes.join(",")}"`],
      };
      worksheet.getCell(`E${i}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${isTrueFalse.join(",")}"`],
      };
      worksheet.getCell(`F${i}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${isTrueFalse.join(",")}"`],
      };
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Deduction_Import_Template.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error generating deduction template:", error);
    res.status(500).json({ error: "Failed to generate deduction template." });
  }
};

// BULK IMPORT DEDUCTIONS
export const importDeductions = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: "Unauthorized to import deductions." });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const workbook = read(file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = utils.sheet_to_json(worksheet);

    const errors = [];
    const deductionsToUpsert = [];

    // Fetch employee IDs and deduction type IDs for validation
    const { data: employees, error: employeeError } = await supabase
      .from("employees")
      .select("id, employee_number")
      .eq("company_id", companyId);
    if (employeeError) throw employeeError;

    const employeeMap = new Map(
      employees.map((emp) => [emp.employee_number, emp.id])
    );

    const { data: deductionTypes, error: deductionTypeError } = await supabase
      .from("deduction_types")
      .select("id, name")
      .eq("company_id", companyId);
    if (deductionTypeError) throw deductionTypeError;

    const deductionTypeMap = new Map(
      deductionTypes.map((type) => [type.name, type.id])
    );

    for (const [index, row] of jsonData.entries()) {
      const rowNumber = index + 2; // Account for header row
      const employeeNumber = row["Employee Number"];
      const deductionName = row["Deduction Name"];
      const value = row["Value"];
      const calculationType = row["Calculation Type"];
      const isActive = row["Is Active"];
      const isOneTime = row["Is One-Time"];
      const startDate = parseDate(
        row["Start Date (YYYY-MM-DD)"],
        rowNumber,
        "Start Date",
        errors
      );
      const endDate = parseDate(
        row["End Date (YYYY-MM-DD)"],
        rowNumber,
        "End Date",
        errors
      );

      // Validation logic
      if (
        !employeeNumber ||
        !deductionName ||
        !value ||
        !calculationType ||
        !startDate
      ) {
        errors.push(`Row ${rowNumber}: Required fields are missing.`);
        continue;
      }

      const employeeId = employeeMap.get(String(employeeNumber).trim());
      if (!employeeId) {
        errors.push(`Row ${rowNumber}: Invalid Employee Number.`);
      }

      const deductionTypeId = deductionTypeMap.get(
        String(deductionName).trim()
      );
      if (!deductionTypeId) {
        errors.push(`Row ${rowNumber}: Invalid Deduction Name.`);
      }

      if (!["Fixed", "Percentage"].includes(String(calculationType).trim())) {
        errors.push(
          `Row ${rowNumber}: Invalid Calculation Type. Must be 'Fixed' or 'Percentage'.`
        );
      }

      if (errors.length === 0) {
        deductionsToUpsert.push({
          company_id: companyId,
          deduction_type_id: deductionTypeId,
          employee_id: employeeId,
          value: parseFloat(value),
          calculation_type: String(calculationType).trim(),
          is_active: String(isActive).trim().toLowerCase() === "true",
          is_one_time: String(isOneTime).trim().toLowerCase() === "true",
          start_date: startDate,
          end_date: endDate,
        });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: "Import failed due to validation errors.",
        details: errors,
      });
    }

    // Use upsert to handle new entries and updates for existing ones.
    const { data, error } = await supabase
      .from("deductions")
      .upsert(deductionsToUpsert, {
        onConflict: "employee_id, deduction_type_id, company_id",
      })
      .select();

    if (error) {
      console.error("Bulk upsert deductions error:", error);
      return res.status(500).json({ error: "Failed to import deductions." });
    }

    res.status(200).json({
      message: "Deductions imported successfully!",
      count: data.length,
    });
  } catch (error) {
    console.error("Import deductions controller error:", error);
    res.status(500).json({ error: error.message });
  }
};
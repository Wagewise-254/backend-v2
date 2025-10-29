import supabase from "../libs/supabaseClient.js";
import ExcelJS from "exceljs";
import pkg from "xlsx";
const { utils, read, SSF } = pkg;

// -------------------- Helper Functions -------------------- //

// Helper function to check for company ownershi
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
export const assignAllowance = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const {
    allowance_type_id,
    employee_id,
    department_id,
    value,
    calculation_type,
    is_recurring = true,
    start_month,
    start_year,
    end_month,
    end_year,
  } = req.body;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res
        .status(403)
        .json({ error: "Unauthorized to assign allowance for this company." });
    }

    const { data, error } = await supabase
      .from("allowances")
      .insert([
        {
          company_id: companyId,
          allowance_type_id,
          employee_id,
          department_id,
          value,
          calculation_type,
          is_recurring,
          start_month,
          start_year,
          end_month,
          end_year,
        },
      ])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to assign allowance" });
  }
};

// GET ALL
export const getAllowances = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res
        .status(403)
        .json({ error: "Unauthorized to fetch allowances for this company." });
    }

    const { data, error } = await supabase
      .from("allowances")
      .select(
        "*, allowance_types(name, is_cash, is_taxable), employees(first_name, last_name)"
      )
      .eq("company_id", companyId);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch allowances" });
  }
};

// GET ONE
export const getAllowanceById = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res
        .status(403)
        .json({ error: "Unauthorized to access this allowance." });
    }

    const { data, error } = await supabase
      .from("allowances")
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(404).json({ error: "Allowance not found" });
  }
};

// UPDATE
export const updateAllowance = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;
  const {
    value,
    calculation_type,
    is_recurring,
    start_month,
    start_year,
    end_month,
    end_year,
  } = req.body;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res
        .status(403)
        .json({ error: "Unauthorized to update this allowance." });
    }

    const { data, error } = await supabase
      .from("allowances")
      .update({
        value,
        calculation_type,
        is_recurring,
        start_month,
        start_year,
        end_month,
        end_year,
      })
      .eq("id", id)
      .eq("company_id", companyId)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to update allowance" });
  }
};

// REMOVE
export const removeAllowance = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res
        .status(403)
        .json({ error: "Unauthorized to remove this allowance." });
    }

    const { error } = await supabase
      .from("allowances")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) throw error;
    res.json({ message: "Allowance removed" });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove allowance" });
  }
};

//bulk delete
export const bulkDeleteAllowances = async (req, res) => {
  const { companyId } = req.params;
  const { allowanceIds } = req.body; // Expecting an array of allowance IDs
  const userId = req.userId;

  if (!allowanceIds || !Array.isArray(allowanceIds) || allowanceIds.length === 0) {
    return res.status(400).json({ error: "No allowance IDs provided for deletion." });
  }
  

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res
        .status(403)
        .json({ error: "Unauthorized to delete allowances for this company." });
    }

    const { error } = await supabase
      .from("allowances")
      .delete()
      .in("id", allowanceIds)
      .eq("company_id", companyId);
    if (error){ 
      console.error("Bulk delete allowances error:", error);
      return res.status(500).json({ error: "Failed to remove allowances" });
    }

    res.status(200).json({ message: `${allowanceIds.length} allowance(s) deleted successfully.` });
  } catch (err) {
    console.error("Bulk delete allowances controller error:", err);
    res.status(500).json({ error: "An unexpected error occurred during bulk deletion." });
  }
};

// GENERATE TEMPLATE FOR BULK ALLOWANCE IMPORT
export const generateAllowanceTemplate = async (req, res) => {
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

    const { data: allowanceTypes, error: allowanceTypeError } = await supabase
      .from("allowance_types")
      .select("name")
      .eq("company_id", companyId);
    if (allowanceTypeError) throw allowanceTypeError;

    //Sort with employee number ascending
    employees.sort((a, b) => {
      const codeA = a.employee_number || "";
      const codeB = b.employee_number || "";
      return codeA.localeCompare(codeB, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Allowances");

    const headers = [
      { header: "Employee Number", key: "employee_number", width: 20 },
      { header: "Allowance Name", key: "allowance_name", width: 20 },
      { header: "Value", key: "value", width: 15 },
      { header: "Calculation Type", key: "calculation_type", width: 20 },
      { header: "Is Recurring (true/false)", key: "is_recurring", width: 25 },
      { header: "Start Month (e.g., January)", key: "start_month", width: 25 },
      { header: "Start Year (e.g., 2024)", key: "start_year", width: 25 },
      { header: "End Month (Optional)", key: "end_month", width: 25 },
      { header: "End Year (Optional)", key: "end_year", width: 25 },
    ];

    worksheet.columns = headers;
    worksheet.getRow(1).font = { bold: true };

    // --- Dropdown Setup ---
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    // Add dropdowns for 'Allowance Name' and 'Calculation Type'
    const allowanceNames = allowanceTypes.map((type) => type.name);
    const calculationTypes = ["Fixed", "Percentage"];
    const isTrueFalse = ["true", "false"];

    employees.forEach((employee) => {
      worksheet.addRow([employee.employee_number]);
    });

    // Add dropdowns to each cell in the relevant columns (B-I)
    for (let i = 2; i <= 1000; i++) {
      // Deduction Name
      worksheet.getCell(`B${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`"${allowanceNames.join(",")}"`],
      };
      // Calculation Type
      worksheet.getCell(`D${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`"${calculationTypes.join(",")}"`],
      };
      // Is Recurring
      worksheet.getCell(`E${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`"${isTrueFalse.join(",")}"`],
      };
      // Start Month
      worksheet.getCell(`F${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`"${monthNames.join(",")}"`],
      };
      // End Month
      worksheet.getCell(`H${i}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${monthNames.join(",")}"`],
      };
      // Note: Start Year (G) and End Year (I) should remain free text/number fields for flexibility.
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Allowance_Import_Template.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error generating allowance template:", error);
    res.status(500).json({ error: "Failed to generate allowance template." });
  }
};

// BULK IMPORT ALLOWANCES
export const importAllowances = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const isValidMonth = (month) => monthNames.includes(month);

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res
        .status(403)
        .json({ error: "Unauthorized to import allowances." });
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
    const allowancesToUpsert = [];

    // Fetch employee IDs and allowance type IDs for validation
    const { data: employees, error: employeeError } = await supabase
      .from("employees")
      .select("id, employee_number")
      .eq("company_id", companyId);
    if (employeeError) throw employeeError;

    const employeeMap = new Map(
      employees.map((emp) => [emp.employee_number, emp.id])
    );

    const { data: allowanceTypes, error: allowanceTypeError } = await supabase
      .from("allowance_types")
      .select("id, name")
      .eq("company_id", companyId);
    if (allowanceTypeError) throw allowanceTypeError;

    const allowanceTypeMap = new Map(
      allowanceTypes.map((type) => [type.name, type.id])
    );

    for (const [index, row] of jsonData.entries()) {
      const rowNumber = index + 2; // Account for header row
      const employeeNumber = row["Employee Number"];
      const allowanceName = row["Allowance Name"];
      const value = row["Value"];
      const calculationType = row["Calculation Type"];
      const isRecurring = row["Is Recurring (true/false)"];
      const startMonth = row["Start Month (e.g., January)"];
      const startYear = row["Start Year (e.g., 2024)"];
      const endMonth = row["End Month (Optional)"] || null;
      const endYear = row["End Year (Optional)"] || null;

      // Validation logic
      if (
        !employeeNumber ||
        !allowanceName ||
        !value ||
        !calculationType ||
        !startMonth ||
        !startYear ||
        isRecurring === undefined
      ) {
        errors.push(`Row ${rowNumber}: Required fields are missing.`);
        continue;
      }

      const employeeId = employeeMap.get(String(employeeNumber).trim());
      if (!employeeId) {
        errors.push(`Row ${rowNumber}: Invalid Employee Number.`);
      }

      const allowanceTypeId = allowanceTypeMap.get(
        String(allowanceName).trim()
      );
      if (!allowanceTypeId) {
        errors.push(`Row ${rowNumber}: Invalid Allowance Name.`);
      }

      if (!["Fixed", "Percentage"].includes(String(calculationType).trim())) {
        errors.push(
          `Row ${rowNumber}: Invalid Calculation Type. Must be 'Fixed' or 'Percentage'.`
        );
      }

      // New Month/Year Validation
      if (!isValidMonth(String(startMonth).trim())) {
        errors.push(`Row ${rowNumber}: Invalid Start Month.`);
      }
      if (isNaN(parseInt(startYear)) || parseInt(startYear) < 1900) {
        errors.push(`Row ${rowNumber}: Invalid Start Year.`);
      }

      if (endMonth && !isValidMonth(String(endMonth).trim())) {
        errors.push(`Row ${rowNumber}: Invalid End Month.`);
      }
      if (endYear && (isNaN(parseInt(endYear)) || parseInt(endYear) < 1900)) {
        errors.push(`Row ${rowNumber}: Invalid End Year.`);
      }

      if (errors.length === 0) {
        allowancesToUpsert.push({
          company_id: companyId,
          allowance_type_id: allowanceTypeId,
          employee_id: employeeId,
          value: parseFloat(value),
          calculation_type: String(calculationType).trim(),
          is_recurring: String(isRecurring).trim().toLowerCase() === "true",
          start_month: String(startMonth).trim(),
          start_year: parseInt(startYear),
          end_month: endMonth ? String(endMonth).trim() : null,
          end_year: endYear ? parseInt(endYear) : null,
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
    // The conflict target is the unique constraint on (employee_id, allowance_type_id, company_id)
    const { data, error } = await supabase
      .from("allowances")
      .upsert(allowancesToUpsert, {
        onConflict: "employee_id, allowance_type_id, company_id",
      })
      .select();

    if (error) {
      console.error("Bulk upsert allowances error:", error);
      return res.status(500).json({ error: "Failed to import allowances." });
    }

    res.status(200).json({
      message: "Allowances imported successfully!",
      count: data.length,
    });
  } catch (error) {
    console.error("Import allowances controller error:", error);
    res.status(500).json({ error: error.message });
  }
};

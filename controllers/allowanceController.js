import supabase from "../libs/supabaseClient.js";
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
export const assignAllowance = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const {
    allowance_type_id,
    employee_id,
    department_id,
    value,
    calculation_type,
    start_date,
    end_date,
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
          start_date,
          end_date,
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
  const { value, calculation_type, start_date, end_date, is_active } = req.body;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res
        .status(403)
        .json({ error: "Unauthorized to update this allowance." });
    }

    const { data, error } = await supabase
      .from("allowances")
      .update({ value, calculation_type, start_date, end_date, is_active })
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

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Allowances");

    const headers = [
      { header: "Employee Number", key: "employee_number", width: 20 },
      { header: "Allowance Name", key: "allowance_name", width: 20 },
      { header: "Value", key: "value", width: 15 },
      { header: "Calculation Type", key: "calculation_type", width: 20 },
      { header: "Is Active", key: "is_active", width: 15 },
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

    // Add dropdowns for 'Allowance Name' and 'Calculation Type'
    const allowanceNames = allowanceTypes.map((type) => type.name);
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
        formulae: [`"${allowanceNames.join(",")}"`],
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
  const { action } = req.body; // To determine if adding or editing

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
      const isActive = row["Is Active"];
      // Use the parseDate helper here
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
        !allowanceName ||
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

      // Simple date validation
      if (isNaN(new Date(startDate))) {
        errors.push(
          `Row ${rowNumber}: Invalid Start Date format. Use YYYY-MM-DD.`
        );
      }
      if (endDate && isNaN(new Date(endDate))) {
        errors.push(
          `Row ${rowNumber}: Invalid End Date format. Use YYYY-MM-DD.`
        );
      }

      if (errors.length === 0) {
        allowancesToUpsert.push({
          company_id: companyId,
          allowance_type_id: allowanceTypeId,
          employee_id: employeeId,
          value: parseFloat(value),
          calculation_type: String(calculationType).trim(),
          is_active: String(isActive).trim().toLowerCase() === "true",
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

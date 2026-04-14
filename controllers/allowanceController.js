// backend/controllers/allowanceController.js
import supabase from "../libs/supabaseClient.js";
import ExcelJS from "exceljs";
import pkg from "xlsx";
import { authorize } from "../utils/authorize.js";
const { utils, read } = pkg;

// Month name constants for validation
const MONTHS = [
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
// -------------------- Helper Functions -------------------- //

// Helper function to check for company access
export const checkCompanyAccess = async (companyId, userId, module, rule) => {
  // 1️ Get workspace_id of the company
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("workspace_id")
    .eq("id", companyId)
    .single();

  if (companyError || !company) return false;

  // 2️ Check if user belongs to that workspace
  const { data: workspaceUser, error: workspaceError } = await supabase
    .from("workspace_users")
    .select("id")
    .eq("workspace_id", company.workspace_id)
    .eq("user_id", userId)
    .single();

  if (workspaceError || !workspaceUser) return false;

  // 3️ Check user belongs to this company
  const { data: companyUser } = await supabase
    .from("company_users")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!companyUser) return false;

  const auth = await authorize(userId, company.workspace_id, module, rule);

  if (!auth.allowed) return false;

  return true;
};

// Helper to validate month name
const isValidMonth = (month) => {
  return MONTHS.includes(month);
};

// Helper to calculate end month/year from start and duration
const calculateEndPeriod = (startMonth, startYear, numberOfMonths) => {
  const startMonthIndex = monthNames.indexOf(startMonth);
  // For 1 month, end should be same as start
  // For 2+ months, calculate properly
  const totalMonths = startMonthIndex + (numberOfMonths - 1); // Subtract 1 to make it inclusive

  const endYear = startYear + Math.floor(totalMonths / 12);
  const endMonthIndex = totalMonths % 12;
  const endMonth = monthNames[endMonthIndex];

  return { endMonth, endYear };
};

// -------------------- Controller Functions -------------------- //

// ASSIGN
export const assignAllowance = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const {
    allowance_type_id,
    applies_to,
    employee_id,
    department_id,
    sub_department_id,
    job_title_id,
    value,
    calculation_type,
    is_recurring,
    start_month,
    start_year,
    number_of_months,
    metadata = {},
    override = false,
  } = req.body;

  // Validate month
  if (!isValidMonth(start_month)) {
    return res.status(400).json({
      error: `Invalid start_month. Must be one of: ${MONTHS.join(", ")}`,
    });
  }

  // Calculate end month/year if non-recurring with duration
  let end_month = null;
  let end_year = null;
  if (!is_recurring && number_of_months && start_month && start_year) {
    const { endMonth, endYear } = calculateEndPeriod(
      start_month,
      parseInt(start_year),
      parseInt(number_of_months),
    );
    end_month = endMonth;
    end_year = endYear;
  }

  const payload = {
    company_id: companyId,
    allowance_type_id,
    applies_to,
    value,
    calculation_type,
    is_recurring,
    start_month,
    start_year,
    number_of_months,
    end_month,
    end_year,
    metadata,
    // Clear other IDs based on applies_to to ensure data integrity
    employee_id: applies_to === "INDIVIDUAL" ? employee_id : null,
    department_id: applies_to === "DEPARTMENT" ? department_id : null,
    sub_department_id:
      applies_to === "SUB_DEPARTMENT" ? sub_department_id : null,
    job_title_id: applies_to === "JOB_TITLE" ? job_title_id : null,
  };

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_write",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to assign allowance.",
      });
    }

    // Check for existing allowance with same criteria
    let existingQuery = supabase
      .from("allowances")
      .select("id")
      .eq("company_id", companyId)
      .eq("allowance_type_id", allowance_type_id)
      .eq("applies_to", applies_to)
      .eq("start_month", start_month)
      .eq("start_year", start_year);

    if (applies_to === "INDIVIDUAL") {
      existingQuery = existingQuery.eq("employee_id", employee_id);
    } else if (applies_to === "DEPARTMENT") {
      existingQuery = existingQuery.eq("department_id", department_id);
    } else if (applies_to === "SUB_DEPARTMENT") {
      existingQuery = existingQuery.eq("sub_department_id", sub_department_id);
    } else if (applies_to === "JOB_TITLE") {
      existingQuery = existingQuery.eq("job_title_id", job_title_id);
    }

    const { data: existing } = await existingQuery.maybeSingle();

    if (existing && !override) {
      return res.status(409).json({
        error: "DUPLICATE_FOUND",
        message:
          "An allowance with these criteria already exists. Do you want to override it?",
        existingId: existing.id,
      });
    }

    let result;
    if (existing && override) {
      // Update existing
      result = await supabase
        .from("allowances")
        .update(payload)
        .eq("id", existing.id)
        .select(
          `
          *,
          allowance_types(name, is_cash, is_taxable, code),
          employees(first_name, last_name, employee_number),
          departments(name),
          sub_departments(name),
          job_titles(title)
        `,
        )
        .single();
    } else {
      // Insert new
      result = await supabase
        .from("allowances")
        .insert([payload])
        .select(
          `
          *,
          allowance_types(name, is_cash, is_taxable, code),
          employees(first_name, last_name, employee_number),
          departments(name),
          sub_departments(name),
          job_titles(title)
        `,
        )
        .single();
    }

    if (result.error) throw result.error;
    res.status(201).json(result.data);
  } catch (err) {
    console.error("Assign allowance error:", err);
    res.status(500).json({ error: "Failed to assign allowance" });
  }
};

// GET ALL
export const getAllowances = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_read",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to view allowances.",
      });
    }

    const { data, error } = await supabase
      .from("allowances")
      .select(
        `
        *, 
        allowance_types(name, is_cash, is_taxable, code), 
        employees(first_name, middle_name, last_name, employee_number),
        departments(name),
        sub_departments(name),
        job_titles(title)
      `,
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Get allowances error:", err);
    res.status(500).json({ error: "Failed to fetch allowances" });
  }
};

// GET ONE
export const getAllowanceById = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_read",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to view allowances.",
      });
    }

    const { data, error } = await supabase
      .from("allowances")
      .select(
        `
        *,
        allowance_types(name, is_cash, is_taxable, code),
        employees(first_name, last_name, employee_number),
        departments(name),
        sub_departments(name),
        job_titles(title)
      `,
      )
      .eq("id", id)
      .eq("company_id", companyId)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Get allowance by id error:", err);
    res.status(404).json({ error: "Allowance not found" });
  }
};

// GET allowances by month/year
export const getAllowancesByMonth = async (req, res) => {
  const { companyId } = req.params;
  const { month, year, allowance_type_id } = req.query;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_read",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to view allowances.",
      });
    }

    let query = supabase
      .from("allowances")
      .select(
        `
        *, 
        allowance_types(name, is_cash, is_taxable, code), 
        employees(first_name, middle_name, last_name, employee_number),
        departments(name),
        sub_departments(name),
        job_titles(title)
      `,
      )
      .eq("company_id", companyId);

    // Filter allowances that are active during the selected month/year
    if (month && year) {
      // Get month index for comparison
      const monthIndex = MONTHS.indexOf(month);
      
      // An allowance is active if:
      // 1. It started BEFORE or DURING the selected month/year
      // 2. AND (it's recurring OR it hasn't ended OR the end date is AFTER or DURING the selected month/year)
      
      // Get the numeric month index (1-12) for comparison
      const selectedMonthNum = monthIndex + 1;
      
      // For the start date comparison: (start_year < selected_year) OR (start_year = selected_year AND start_month_index <= selected_month_index)
      // For the end date comparison: (is_recurring = true) OR (end_year IS NULL) OR (end_year > selected_year) OR (end_year = selected_year AND end_month_index >= selected_month_index)
      
      // We need to filter after fetching because Supabase doesn't support complex date logic well
      // But we can do a broader filter first
      query = query.or(`start_year.lt.${year},and(start_year.eq.${year},start_month.lte.${month})`);
    }
    // Filter by allowance type
    if (allowance_type_id) {
      query = query.eq("allowance_type_id", allowance_type_id);
    }

    const { data, error } = await query.order("created_at", {
      ascending: false,
    });

    if (error) throw error;
    
    // Filter the results to only include allowances active during the selected month
    const filteredData = data.filter((allowance) => {
      const startYear = allowance.start_year;
      const startMonth = allowance.start_month;
      const startMonthIndex = MONTHS.indexOf(startMonth);
      
      const selectedYear = parseInt(year);
      const selectedMonthIndex = MONTHS.indexOf(month);
      
      // Check if allowance started before or during the selected month
      let startedBeforeOrDuring = false;
      if (startYear < selectedYear) {
        startedBeforeOrDuring = true;
      } else if (startYear === selectedYear) {
        if (startMonthIndex <= selectedMonthIndex) {
          startedBeforeOrDuring = true;
        }
      }
      
      if (!startedBeforeOrDuring) return false;
      
      // If recurring, it's always active
      if (allowance.is_recurring) return true;
      
      // If not recurring, check if it hasn't ended or ends after the selected month
      if (!allowance.end_month || !allowance.end_year) return true;
      
      const endYear = allowance.end_year;
      const endMonth = allowance.end_month;
      const endMonthIndex = MONTHS.indexOf(endMonth);
      
      // Allowance is active if end date is after or during selected month
      if (endYear > selectedYear) return true;
      if (endYear === selectedYear && endMonthIndex >= selectedMonthIndex) return true;
      
      return false;
    });
    
    res.json(filteredData);
  } catch (err) {
    console.error("Get allowances by month error:", err);
    res.status(500).json({ error: "Failed to fetch allowances" });
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
    number_of_months,
    metadata,
  } = req.body;

  // Validate month if provided
  if (start_month && !isValidMonth(start_month)) {
    return res.status(400).json({
      error: `Invalid start_month. Must be one of: ${MONTHS.join(", ")}`,
    });
  }

  // Calculate end month/year if non-recurring with duration
  let end_month = null;
  let end_year = null;
  if (!is_recurring && number_of_months && start_month && start_year) {
    const { endMonth, endYear } = calculateEndPeriod(
      start_month,
      parseInt(start_year),
      parseInt(number_of_months),
    );
    end_month = endMonth;
    end_year = endYear;
  }

  const payload = {
    value,
    calculation_type,
    is_recurring,
    start_month,
    start_year,
    number_of_months,
    end_month,
    end_year,
    metadata,
  };

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_write",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to update allowance.",
      });
    }

    const { data, error } = await supabase
      .from("allowances")
      .update(payload)
      .eq("id", id)
      .eq("company_id", companyId)
      .select(
        `
        *,
        allowance_types(name, is_cash, is_taxable, code),
        employees(first_name, last_name, employee_number),
        departments(name),
        sub_departments(name),
        job_titles(title)
      `,
      )
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Update allowance error:", err);
    res.status(500).json({ error: "Failed to update allowance" });
  }
};

// REMOVE
export const removeAllowance = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_delete",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to delete allowance.",
      });
    }

    const { error } = await supabase
      .from("allowances")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId);

    if (error) throw error;
    res.json({ message: "Allowance removed successfully" });
  } catch (err) {
    console.error("Remove allowance error:", err);
    res.status(500).json({ error: "Failed to remove allowance" });
  }
};

// BULK DELETE
export const bulkDeleteAllowances = async (req, res) => {
  const { companyId } = req.params;
  const { allowanceIds } = req.body;
  const userId = req.userId;

  if (
    !allowanceIds ||
    !Array.isArray(allowanceIds) ||
    allowanceIds.length === 0
  ) {
    return res
      .status(400)
      .json({ error: "No allowance IDs provided for deletion." });
  }

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_delete",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to delete allowances.",
      });
    }

    const { error } = await supabase
      .from("allowances")
      .delete()
      .in("id", allowanceIds)
      .eq("company_id", companyId);

    if (error) {
      console.error("Bulk delete allowances error:", error);
      return res.status(500).json({ error: "Failed to remove allowances" });
    }

    res.status(200).json({
      message: `${allowanceIds.length} allowance(s) deleted successfully.`,
    });
  } catch (err) {
    console.error("Bulk delete allowances controller error:", err);
    res
      .status(500)
      .json({ error: "An unexpected error occurred during bulk deletion." });
  }
};

// GENERATE TEMPLATE FOR BULK ALLOWANCE IMPORT
export const generateAllowanceTemplate = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_read",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to view allowances.",
      });
    }

    // Fetch all required data
    const [
      employeesResult,
      allowanceTypesResult,
      departmentsResult,
      subDepartmentsResult,
      jobTitlesResult,
    ] = await Promise.all([
      supabase
        .from("employees")
        .select("employee_number, first_name, last_name, employee_status")
        .eq("company_id", companyId)
        .in("employee_status", ["ACTIVE", "ON LEAVE"]),
      supabase
        .from("allowance_types")
        .select("name, code")
        .eq("company_id", companyId),
      supabase.from("departments").select("name").eq("company_id", companyId),
      supabase
        .from("sub_departments")
        .select("name")
        .eq("company_id", companyId),
      supabase.from("job_titles").select("title").eq("company_id", companyId),
    ]);

    if (employeesResult.error) throw employeesResult.error;
    if (allowanceTypesResult.error) throw allowanceTypesResult.error;
    if (departmentsResult.error) throw departmentsResult.error;
    if (subDepartmentsResult.error) throw subDepartmentsResult.error;
    if (jobTitlesResult.error) throw jobTitlesResult.error;

    const employees = employeesResult.data || [];
    const allowanceTypes = allowanceTypesResult.data || [];
    const departments = departmentsResult.data || [];
    const subDepartments = subDepartmentsResult.data || [];
    const jobTitles = jobTitlesResult.data || [];

    // Sort data for better readability
    employees.sort((a, b) => {
      const numA = a.employee_number || "";
      const numB = b.employee_number || "";
      return numA.localeCompare(numB, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    allowanceTypes.sort((a, b) => a.name.localeCompare(b.name));
    departments.sort((a, b) => a.name.localeCompare(b.name));
    subDepartments.sort((a, b) => a.name.localeCompare(b.name));
    jobTitles.sort((a, b) => a.title.localeCompare(b.title));

    const workbook = new ExcelJS.Workbook();

    // --- MAIN SHEET ---
    const mainSheet = workbook.addWorksheet("Allowances");

    const headers = [
      { header: "Allowance Type Name", key: "type_name", width: 25 },
      { header: "Applies To", key: "applies_to", width: 20 },
      { header: "Target Identifier", key: "target", width: 35 },
      { header: "Value", key: "value", width: 15 },
      { header: "Calc Type", key: "calc_type", width: 15 },
      { header: "Is Recurring", key: "recurring", width: 15 },
      { header: "Start Month", key: "start_month", width: 15 },
      { header: "Start Year", key: "start_year", width: 12 },
      { header: "Duration (Months)", key: "duration", width: 15 },
      { header: "Metadata JSON", key: "metadata", width: 40 },
    ];

    mainSheet.columns = headers;

    // Style header row
    const headerRow = mainSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // Add sample row with instructions
    mainSheet.addRow([
      "Housing",
      "INDIVIDUAL",
      "EMP001",
      "5000",
      "FIXED",
      "FALSE",
      "January",
      "2024",
      "12",
      '{"notes": "Monthly housing allowance"}',
    ]);

    // Add empty rows for data entry (up to 1000 rows)
    for (let i = 3; i <= 1000; i++) {
      mainSheet.addRow([]);
    }

    // --- REFERENCE SHEET ---
    const refSheet = workbook.addWorksheet("Reference (Read Only)");

    // Style reference sheet header
    const refHeaderRow = refSheet.getRow(1);
    refHeaderRow.font = { bold: true };
    refHeaderRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFE699" },
    };

    // Add Employees section
    refSheet.getCell("A1").value = "EMPLOYEES";
    refSheet.getCell("A2").value = "Employee Number";
    refSheet.getCell("B2").value = "Full Name";
    refSheet.getCell("C2").value = "Status";

    employees.forEach((emp, index) => {
      const rowNum = index + 3;
      refSheet.getCell(`A${rowNum}`).value = emp.employee_number;
      refSheet.getCell(`B${rowNum}`).value =
        `${emp.first_name} ${emp.last_name}`.trim();
      refSheet.getCell(`C${rowNum}`).value = emp.employee_status;

      //  Color code the status
      if (emp.employee_status === "ON LEAVE") {
        refSheet.getCell(`C${rowNum}`).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFE699" }, // Light yellow for on leave
        };
      } else if (emp.employee_status === "ACTIVE") {
        refSheet.getCell(`C${rowNum}`).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFC6EFCE" }, // Light green for active
        };
      }
    });

    // Add Departments section
    refSheet.getCell("D1").value = "DEPARTMENTS";
    refSheet.getCell("D2").value = "Department Name";

    departments.forEach((dept, index) => {
      refSheet.getCell(`D${index + 3}`).value = dept.name;
    });

    // Add Sub-Departments section
    refSheet.getCell("F1").value = "SUB-DEPARTMENTS";
    refSheet.getCell("F2").value = "Sub-Department Name";

    subDepartments.forEach((sub, index) => {
      refSheet.getCell(`F${index + 3}`).value = sub.name;
    });

    // Add Job Titles section
    refSheet.getCell("H1").value = "JOB TITLES";
    refSheet.getCell("H2").value = "Job Title";

    jobTitles.forEach((job, index) => {
      refSheet.getCell(`H${index + 3}`).value = job.title;
    });

    // Add Months reference
    refSheet.getCell("J1").value = "MONTHS";
    refSheet.getCell("J2").value = "Valid Months";

    MONTHS.forEach((month, index) => {
      refSheet.getCell(`J${index + 3}`).value = month;
    });

    // Style reference sheet columns
    refSheet.columns = [
      { width: 20 }, // A: Employee Number
      { width: 30 }, // B: Full Name
      { width: 15 }, // C: Status
      { width: 5 }, // D: Spacer
      { width: 25 }, // E: Department Name
      { width: 5 }, // F: Spacer
      { width: 25 }, // G: Sub-Department Name
      { width: 5 }, // H: Spacer
      { width: 25 }, // I: Job Title
      { width: 5 }, // J: Spacer
      { width: 20 }, // K: Months
    ];

    // Protect reference sheet
    refSheet.protect("", {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatCells: false,
      formatColumns: false,
      formatRows: false,
      insertColumns: false,
      insertRows: false,
      deleteColumns: false,
      deleteRows: false,
    });

    // --- DROPDOWNS ON MAIN SHEET ---

    // Prepare dropdown lists
    const typeNames = allowanceTypes.map((t) => t.name);
    const appliesToOptions = [
      "INDIVIDUAL",
      "COMPANY",
      "DEPARTMENT",
      "SUB_DEPARTMENT",
      "JOB_TITLE",
    ];
    const employeeList = employees.map((e) => e.employee_number);
    const departmentList = departments.map((d) => d.name);
    const subDepartmentList = subDepartments.map((s) => s.name);
    const jobTitleList = jobTitles.map((j) => j.title);

    for (let i = 2; i <= 1000; i++) {
      // Allowance Type dropdown
      if (typeNames.length > 0) {
        mainSheet.getCell(`A${i}`).dataValidation = {
          type: "list",
          allowBlank: false,
          formulae: [`"${typeNames.join(",")}"`],
          showErrorMessage: true,
          errorStyle: "stop",
          errorTitle: "Invalid Allowance Type",
          error: "Please select a valid allowance type from the list",
        };
      }

      // Applies To dropdown
      mainSheet.getCell(`B${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`"${appliesToOptions.join(",")}"`],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Invalid Applies To",
        error:
          "Please select INDIVIDUAL, COMPANY, DEPARTMENT, SUB_DEPARTMENT, or JOB_TITLE",
      };

      // Calculation Type dropdown
      mainSheet.getCell(`E${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"FIXED,PERCENTAGE"'],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Invalid Calculation Type",
        error: "Please select FIXED or PERCENTAGE",
      };

      // Is Recurring dropdown
      mainSheet.getCell(`F${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"TRUE,FALSE"'],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Invalid Value",
        error: "Please select TRUE or FALSE",
      };

      // Start Month dropdown
      mainSheet.getCell(`G${i}`).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`"${MONTHS.join(",")}"`],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Invalid Month",
        error: `Please select a valid month from the list`,
      };
    }

    // Add notes sheet
    const notesSheet = workbook.addWorksheet("Instructions");
    notesSheet.getCell("A1").value = "INSTRUCTIONS FOR BULK ALLOWANCE IMPORT";
    notesSheet.getCell("A1").font = { bold: true, size: 14 };

    notesSheet.getCell("A3").value =
      '1. Use the "Allowances" sheet to enter your data';
    notesSheet.getCell("A4").value =
      '2. Use the "Reference (Read Only)" sheet to see available employees, departments, etc.';
    notesSheet.getCell("A5").value =
      "3. Only ACTIVE and ON LEAVE employees are shown in the reference sheet";
    notesSheet.getCell("A6").value = "4. Column explanations:";
    notesSheet.getCell("A7").value =
      "   - Allowance Type Name: Select from dropdown (based on your configured allowance types)";
    notesSheet.getCell("A8").value =
      "   - Applies To: Select who this allowance applies to";
    notesSheet.getCell("A9").value =
      "   - Target Identifier: Based on Applies To selection:";
    notesSheet.getCell("A10").value =
      "     * INDIVIDUAL: Employee Number (see Reference sheet - only Active/On Leave)";
    notesSheet.getCell("A11").value =
      "     * DEPARTMENT: Department Name (see Reference sheet)";
    notesSheet.getCell("A12").value =
      "     * SUB_DEPARTMENT: Sub-Department Name (see Reference sheet)";
    notesSheet.getCell("A13").value =
      "     * JOB_TITLE: Job Title (see Reference sheet)";
    notesSheet.getCell("A14").value =
      '     * COMPANY: Leave blank or enter "COMPANY"';
    notesSheet.getCell("A15").value =
      "   - Value: Numeric value for the allowance";
    notesSheet.getCell("A16").value = "   - Calc Type: FIXED or PERCENTAGE";
    notesSheet.getCell("A17").value =
      "   - Is Recurring: TRUE (repeats) or FALSE (one-time)";
    notesSheet.getCell("A18").value =
      "   - Start Month: Select from dropdown (January-December)";
    notesSheet.getCell("A19").value =
      "   - Start Year: 4-digit year (e.g., 2024)";
    notesSheet.getCell("A20").value =
      "   - Duration: For non-recurring, number of months (optional)";
    notesSheet.getCell("A21").value =
      "   - Metadata: JSON format for additional data (optional)";

    notesSheet.getCell("A23").value =
      "5. All fields except Duration and Metadata are required";
    notesSheet.getCell("A24").value =
      "6. Employees with status TERMINATED or SUSPENDED are excluded from the reference list";

    // Style notes sheet
    notesSheet.columns = [{ width: 80 }];

    // Set response headers
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Allowance_Import_Template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error generating allowance template:", error);
    res.status(500).json({ error: "Failed to generate allowance template." });
  }
};

// Add bulk import preview endpoint
export const previewImportAllowances = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_write",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to import allowances.",
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const workbook = read(file.buffer, { type: "buffer" });
    const mainSheetName = workbook.SheetNames.find(
      (name) => name === "Allowances" || name.includes("Allowance"),
    );

    if (!mainSheetName) {
      return res.status(400).json({
        error: "Invalid template format. Please use the downloaded template.",
      });
    }

    const worksheet = workbook.Sheets[mainSheetName];
    const jsonData = utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });

    const dataRows = jsonData
      .slice(1)
      .filter(
        (row) =>
          row &&
          row.some(
            (cell) => cell !== null && cell !== undefined && cell !== "",
          ),
      );

    if (dataRows.length === 0) {
      return res
        .status(400)
        .json({ error: "No data found in the uploaded file." });
    }

    // Pre-fetch all maps
    const [employees, depts, subs, titles, types, existingAllowances] =
      await Promise.all([
        supabase
          .from("employees")
          .select("id, employee_number, first_name, middle_name, last_name")
          .eq("company_id", companyId),
        supabase
          .from("departments")
          .select("id, name")
          .eq("company_id", companyId),
        supabase
          .from("sub_departments")
          .select("id, name")
          .eq("company_id", companyId),
        supabase
          .from("job_titles")
          .select("id, title")
          .eq("company_id", companyId),
        supabase
          .from("allowance_types")
          .select("id, name, code")
          .eq("company_id", companyId),
        supabase
          .from("allowances")
          .select(
            "id, allowance_type_id, applies_to, employee_id, department_id, sub_department_id, job_title_id, start_month, start_year",
          )
          .eq("company_id", companyId),
      ]);

    const empMap = new Map(
      employees.data.map((e) => [e.employee_number, e.id]),
    );
    const deptMap = new Map(depts.data.map((d) => [d.name?.trim(), d.id]));
    const typeMap = new Map(
      types.data.map((t) => [t.name?.trim(), { id: t.id, code: t.code }]),
    );
    const subMap = new Map(subs.data.map((s) => [s.name?.trim(), s.id]));
    const titleMap = new Map(titles.data.map((j) => [j.title?.trim(), j.id]));

    // Create a Set of existing allowances for duplicate detection
    const existingSet = new Set();
    existingAllowances.data.forEach((allowance) => {
      const key = `${allowance.allowance_type_id}|${allowance.applies_to}|${allowance.employee_id || ""}|${allowance.department_id || ""}|${allowance.sub_department_id || ""}|${allowance.job_title_id || ""}|${allowance.start_month}|${allowance.start_year}`;
      existingSet.add(key);
    });

    const toInsert = [];
    const duplicates = [];
    const errors = [];

    for (const [index, row] of dataRows.entries()) {
      const rowNumber = index + 2;
      const typeName = row[0]?.toString().trim();
      const appliesTo = row[1]?.toString().trim().toUpperCase();
      const target = row[2]?.toString().trim();
      const value = row[3];
      const calculationType = row[4]?.toString().trim().toUpperCase();
      const isRecurring = row[5]?.toString().trim().toUpperCase();
      const startMonth = row[6]?.toString().trim();
      const startYear = row[7] ? parseInt(row[7].toString().trim()) : null;
      const numberOfMonths = row[8] ? parseInt(row[8].toString().trim()) : null;
      const metadataStr = row[9]?.toString().trim();

      if (!typeName && !appliesTo && !target && !value) continue;

      // Validation logic (same as before)
      const missingFields = [];
      if (!typeName) missingFields.push("Allowance Type Name");
      if (!appliesTo) missingFields.push("Applies To");
      if (appliesTo !== "COMPANY" && !target)
        missingFields.push("Target Identifier");
      if (!value) missingFields.push("Value");
      if (!calculationType) missingFields.push("Calc Type");
      if (!isRecurring) missingFields.push("Is Recurring");
      if (!startMonth) missingFields.push("Start Month");
      if (!startYear) missingFields.push("Start Year");

      if (missingFields.length > 0) {
        errors.push({
          row: rowNumber,
          type: "missing_fields",
          message: `Missing: ${missingFields.join(", ")}`,
        });
        continue;
      }

      const validAppliesTo = [
        "INDIVIDUAL",
        "COMPANY",
        "DEPARTMENT",
        "SUB_DEPARTMENT",
        "JOB_TITLE",
      ];
      if (!validAppliesTo.includes(appliesTo)) {
        errors.push({
          row: rowNumber,
          type: "invalid_applies_to",
          message: `Invalid Applies To: ${appliesTo}`,
        });
        continue;
      }

      if (!isValidMonth(startMonth)) {
        errors.push({
          row: rowNumber,
          type: "invalid_month",
          message: `Invalid month: ${startMonth}`,
        });
        continue;
      }

      if (isNaN(startYear) || startYear < 1900 || startYear > 2100) {
        errors.push({
          row: rowNumber,
          type: "invalid_year",
          message: `Invalid year: ${startYear}`,
        });
        continue;
      }

      const typeInfo = typeMap.get(typeName);
      if (!typeInfo) {
        errors.push({
          row: rowNumber,
          type: "type_not_found",
          message: `Allowance type not found: ${typeName}`,
        });
        continue;
      }

      let targetId = null;
      if (appliesTo === "INDIVIDUAL") {
        targetId = empMap.get(target);
        if (!targetId) {
          errors.push({
            row: rowNumber,
            type: "employee_not_found",
            message: `Employee not found: ${target}`,
          });
          continue;
        }
      } else if (appliesTo === "DEPARTMENT") {
        targetId = deptMap.get(target);
        if (!targetId) {
          errors.push({
            row: rowNumber,
            type: "department_not_found",
            message: `Department not found: ${target}`,
          });
          continue;
        }
      } else if (appliesTo === "SUB_DEPARTMENT") {
        targetId = subMap.get(target);
        if (!targetId) {
          errors.push({
            row: rowNumber,
            type: "sub_department_not_found",
            message: `Sub-department not found: ${target}`,
          });
          continue;
        }
      } else if (appliesTo === "JOB_TITLE") {
        targetId = titleMap.get(target);
        if (!targetId) {
          errors.push({
            row: rowNumber,
            type: "job_title_not_found",
            message: `Job title not found: ${target}`,
          });
          continue;
        }
      }

      if (!["FIXED", "PERCENTAGE"].includes(calculationType)) {
        errors.push({
          row: rowNumber,
          type: "invalid_calc_type",
          message: `Calculation type must be FIXED or PERCENTAGE`,
        });
        continue;
      }

      let recurringBool;
      const recurringStr = String(isRecurring).toUpperCase();
      if (
        recurringStr === "TRUE" ||
        recurringStr === "YES" ||
        recurringStr === "1"
      ) {
        recurringBool = true;
      } else if (
        recurringStr === "FALSE" ||
        recurringStr === "NO" ||
        recurringStr === "0"
      ) {
        recurringBool = false;
      } else {
        errors.push({
          row: rowNumber,
          type: "invalid_recurring",
          message: `Is Recurring must be TRUE or FALSE`,
        });
        continue;
      }

      const numericValue = parseFloat(value);
      if (isNaN(numericValue) || numericValue < 0) {
        errors.push({
          row: rowNumber,
          type: "invalid_value",
          message: `Value must be a positive number`,
        });
        continue;
      }

      let metadata = {};
      if (metadataStr) {
        try {
          metadata = JSON.parse(metadataStr);
        } catch (e) {
          errors.push({
            row: rowNumber,
            type: "invalid_json",
            message: `Invalid JSON in Metadata`,
          });
          continue;
        }
      }

      // Check for duplicate
      const duplicateKey = `${typeInfo.id}|${appliesTo}|${appliesTo === "INDIVIDUAL" ? targetId : ""}|${appliesTo === "DEPARTMENT" ? targetId : ""}|${appliesTo === "SUB_DEPARTMENT" ? targetId : ""}|${appliesTo === "JOB_TITLE" ? targetId : ""}|${startMonth}|${startYear}`;

      const isDuplicate = existingSet.has(duplicateKey);
      const empData = employees.data.find((e) => e.id === targetId);
      const record = {
        row: rowNumber,
        data: {
          company_id: companyId,
          allowance_type_id: typeInfo.id,
          applies_to: appliesTo,
          employee_id: appliesTo === "INDIVIDUAL" ? targetId : null,
          department_id: appliesTo === "DEPARTMENT" ? targetId : null,
          sub_department_id: appliesTo === "SUB_DEPARTMENT" ? targetId : null,
          job_title_id: appliesTo === "JOB_TITLE" ? targetId : null,
          value: numericValue,
          calculation_type: calculationType,
          is_recurring: recurringBool,
          start_month: startMonth,
          start_year: startYear,
          number_of_months: numberOfMonths,
          metadata: metadata,
          allowance_type_name: typeName,
          recipient_name: target,
          // Add employee details if applicable
          ...(appliesTo === "INDIVIDUAL" && empData
            ? {
                employee_number: empData.employee_number,
                employee_full_name:
                  `${empData.first_name} ${empData.middle_name || ""} ${empData.last_name}`.trim(),
              }
            : {}),
          ...(appliesTo === "DEPARTMENT"
            ? {
                department_name: target,
              }
            : {}),
          ...(appliesTo === "SUB_DEPARTMENT"
            ? {
                sub_department_name: target,
              }
            : {}),
          ...(appliesTo === "JOB_TITLE"
            ? {
                job_title_name: target,
              }
            : {}),
        },
      };

      if (isDuplicate) {
        duplicates.push({ ...record, type: "duplicate" });
      } else {
        toInsert.push(record);
      }
    }

    res.json({
      summary: {
        total: dataRows.length,
        valid: toInsert.length,
        duplicates: duplicates.length,
        errors: errors.length,
      },
      valid: toInsert,
      duplicates: duplicates,
      errors: errors,
    });
  } catch (error) {
    console.error("Preview import error:", error);
    res.status(500).json({ error: "Failed to preview import" });
  }
};

// Update importAllowances to accept override selection
export const importAllowances = async (req, res) => {
  const { companyId } = req.params;
  const { allowances, overrideIds = [], skipDuplicates = true } = req.body;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_write",
    );
    if (!isAuthorized) {
      return res.status(403).json({
        error: "Unauthorized to import allowances.",
      });
    }

    const results = {
      inserted: [],
      updated: [],
      skipped: [],
      errors: [],
    };

    for (const allowance of allowances) {
      try {
        // Check if exists
        let existingQuery = supabase
          .from("allowances")
          .select("id, value, calculation_type, is_recurring, number_of_months, metadata")
          .eq("company_id", companyId)
          .eq("allowance_type_id", allowance.allowance_type_id)
          .eq("applies_to", allowance.applies_to)
          .eq("start_month", allowance.start_month)
          .eq("start_year", allowance.start_year);

        if (allowance.applies_to === "INDIVIDUAL") {
          existingQuery = existingQuery.eq("employee_id", allowance.employee_id);
        } else if (allowance.applies_to === "DEPARTMENT") {
          existingQuery = existingQuery.eq("department_id", allowance.department_id);
        } else if (allowance.applies_to === "SUB_DEPARTMENT") {
          existingQuery = existingQuery.eq("sub_department_id", allowance.sub_department_id);
        } else if (allowance.applies_to === "JOB_TITLE") {
          existingQuery = existingQuery.eq("job_title_id", allowance.job_title_id);
        }

        const { data: existing } = await existingQuery.maybeSingle();

        // Check if this allowance should be overridden
        const shouldOverride = overrideIds.includes(allowance.row?.toString());
        
        if (existing && shouldOverride) {
          // Override existing - update the values
          const { error: updateError } = await supabase
            .from("allowances")
            .update({
              value: allowance.value,
              calculation_type: allowance.calculation_type,
              is_recurring: allowance.is_recurring,
              number_of_months: allowance.number_of_months || null,
              metadata: allowance.metadata || {},
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);

          if (updateError) throw updateError;
          results.updated.push({
            ...allowance,
            old_value: existing.value,
            new_value: allowance.value,
          });
        } else if (existing && skipDuplicates) {
          // Skip duplicate
          results.skipped.push({
            ...allowance,
            reason: "Duplicate exists and skipDuplicates is true",
          });
        } else if (!existing) {
          // Insert new
          // Calculate end month/year if needed
          let end_month = null;
          let end_year = null;
          if (!allowance.is_recurring && allowance.number_of_months) {
            const { endMonth, endYear } = calculateEndPeriod(
              allowance.start_month,
              allowance.start_year,
              allowance.number_of_months
            );
            end_month = endMonth;
            end_year = endYear;
          }

          const { error: insertError } = await supabase
            .from("allowances")
            .insert([{
              company_id: companyId,
              allowance_type_id: allowance.allowance_type_id,
              applies_to: allowance.applies_to,
              employee_id: allowance.employee_id,
              department_id: allowance.department_id,
              sub_department_id: allowance.sub_department_id,
              job_title_id: allowance.job_title_id,
              value: allowance.value,
              calculation_type: allowance.calculation_type,
              is_recurring: allowance.is_recurring,
              start_month: allowance.start_month,
              start_year: allowance.start_year,
              number_of_months: allowance.number_of_months || null,
              end_month: end_month,
              end_year: end_year,
              metadata: allowance.metadata || {},
            }]);

          if (insertError) throw insertError;
          results.inserted.push(allowance);
        }
      } catch (err) {
        results.errors.push({ 
          row: allowance.row, 
          allowance_type: allowance.allowance_type_name,
          recipient: allowance.recipient_name,
          error: err.message 
        });
      }
    }

    res.json({
      message: `Import completed: ${results.inserted.length} inserted, ${results.updated.length} updated, ${results.skipped.length} skipped, ${results.errors.length} errors`,
      results,
    });
  } catch (error) {
    console.error("Import allowances error:", error);
    res.status(500).json({ error: "Failed to import allowances" });
  }
};

// Add export endpoint
export const exportAllowances = async (req, res) => {
  const { companyId } = req.params;
  const { month, year, allowance_type_id } = req.query;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyAccess(
      companyId,
      userId,
      "PAYROLL",
      "can_read",
    );
    if (!isAuthorized) {
      return res
        .status(403)
        .json({ error: "Unauthorized to export allowances." });
    }

    let query = supabase
      .from("allowances")
      .select(
        `
        *,
        allowance_types(name, is_cash, is_taxable, code),
        employees(first_name, middle_name, last_name, employee_number),
        departments(name),
        sub_departments(name),
        job_titles(title)
      `,
      )
      .eq("company_id", companyId);

    if (month && year) {
      query = query.or(
        `and(start_year.lte.${year},start_month.lte.${month}),start_year.lt.${year}`,
      );
    }

    if (allowance_type_id) {
      query = query.eq("allowance_type_id", allowance_type_id);
    }

    const { data, error } = await query;
    if (error) throw error;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Allowances_${month}_${year}`);

    worksheet.columns = [
      { header: "Allowance Type", key: "type", width: 25 },
      { header: "Applies To", key: "applies_to", width: 20 },
      { header: "Recipient", key: "recipient", width: 35 },
      { header: "Value", key: "value", width: 15 },
      { header: "Calculation Type", key: "calc_type", width: 15 },
      { header: "Is Recurring", key: "recurring", width: 15 },
      { header: "Start Month", key: "start_month", width: 15 },
      { header: "Start Year", key: "start_year", width: 12 },
      { header: "End Month", key: "end_month", width: 15 },
      { header: "End Year", key: "end_year", width: 12 },
    ];

    for (const allowance of data) {
      let recipient = "";
      if (allowance.applies_to === "INDIVIDUAL" && allowance.employees) {
        recipient = `${allowance.employees.first_name} ${allowance.employees.last_name} (${allowance.employees.employee_number})`;
      } else if (allowance.applies_to === "DEPARTMENT") {
        recipient = allowance.departments?.name || "";
      } else if (allowance.applies_to === "SUB_DEPARTMENT") {
        recipient = allowance.sub_departments?.name || "";
      } else if (allowance.applies_to === "JOB_TITLE") {
        recipient = allowance.job_titles?.title || "";
      } else if (allowance.applies_to === "COMPANY") {
        recipient = "All Employees";
      }

      worksheet.addRow({
        type: allowance.allowance_types?.name,
        applies_to: allowance.applies_to,
        recipient: recipient,
        value: allowance.value,
        calc_type: allowance.calculation_type,
        recurring: allowance.is_recurring ? "Yes" : "No",
        start_month: allowance.start_month,
        start_year: allowance.start_year,
        end_month: allowance.end_month || "",
        end_year: allowance.end_year || "",
      });
    }

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Allowances_${month}_${year}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Export allowances error:", error);
    res.status(500).json({ error: "Failed to export allowances" });
  }
};

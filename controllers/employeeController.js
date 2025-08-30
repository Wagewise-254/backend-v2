// backend/controllers/employeeController.js
import supabase from "../libs/supabaseClient.js";
import ExcelJS from "exceljs";
import pkg from 'xlsx';
import { sendEmail } from "../services/email.js";
const { utils, read, SSF } = pkg;

// -------------------- Helper Functions -------------------- //

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

// Normalize Yes/No → boolean
function parseYesNo(value) {
  if (!value) return false;
  return value.toString().trim().toLowerCase() === "yes";
}

// Normalize No/Yes → inverted boolean (for fields like pays_paye)
function parseNoDefaultYes(value) {
  if (!value) return true; // default = yes
  return value.toString().trim().toLowerCase() !== "no";
}

// ---- NEW: Function to send a well-styled welcome email ----
const sendWelcomeEmail = async (toEmail, employeeName, companyName) => {
    try {
        await sendEmail({
            to: toEmail,
            subject: `Welcome to ${companyName || 'Your Company'}! Your Wagewise Employee Account is Ready`,
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; padding: 20px;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                            <td align="center" style="padding-bottom: 20px;">
                                <h1 style="color: #7F5EFD; font-size: 28px; margin: 0;">Wagewise</h1>
                            </td>
                        </tr>
                        <tr>
                            <td align="center">
                                <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.05);">
                                    <tr>
                                        <td style="padding: 40px;">
                                            <p style="font-size: 18px; margin-bottom: 20px;">Dear ${employeeName},</p>
                                            <p style="font-size: 16px; margin-bottom: 20px;">Welcome aboard! We are excited to have you join ${companyName || 'our team'}.</p>
                                            <p style="font-size: 16px; margin-bottom: 30px;">Your employee account has been set up on Wagewise. You will receive important communications, including your payslips, via this platform.</p>
                                            <p style="font-size: 16px; margin-top: 20px;">Best regards,<br>The ${companyName || 'Company'} Team</p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <td align="center" style="padding-top: 20px;">
                                <p style="font-size: 12px; color: #888;">&copy; ${new Date().getFullYear()} Wagewise. All rights reserved.</p>
                            </td>
                        </tr>
                    </table>
                </div>
            `,
        });
        console.log(`Welcome email sent to ${toEmail}`);
    } catch (emailError) {
        console.error(`Failed to send welcome email to ${toEmail}:`, emailError.message);
    }
};

// -------------------- Employee Controllers -------------------- //

// Get all employees for a specific company
export const getEmployees = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    // Ensure the user owns the company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res
        .status(403)
        .json({ error: "Unauthorized to access employees for this company." });
    }

    const { data, error } = await supabase
      .from("employees")
      .select(
        `
                *,
                departments (
                    name
                ),
                employee_bank_details (
                    *
                )
            `
      ) // Select all employee fields and department name
      .eq("company_id", companyId);

    if (error) {
      console.error("Fetch employees error:", error);
      throw new Error("Failed to fetch employees.");
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get a single employee by ID
export const getEmployeeById = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;

  try {
    // Ensure the user owns the company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res
        .status(403)
        .json({ error: "Unauthorized to access this employee." });
    }

    const { data, error } = await supabase
      .from("employees")
      .select(
        `
                *,
                departments (
                    name
                )
            `
      )
      .eq("id", employeeId)
      .eq("company_id", companyId)
      .single();

    if (error) {
      console.error("Fetch employee by ID error:", error);
      if (error.code === "PGRST116") {
        // No rows found
        return res.status(404).json({ error: "Employee not found." });
      }
      throw new Error("Failed to fetch employee details.");
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Add a new employee
export const addEmployee = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const {
    employee_number,
    first_name,
    last_name,
    other_names,
    email,
    phone,
    date_of_birth,
    gender,
    date_joined,
    job_title,
    department_id,
    job_type,
    employee_status,
    employee_status_effective_date,
    id_type,
    id_number,
    krapin,
    shif_number,
    nssf_number,
    citizenship,
    has_disability,
    salary,
    employee_type,
    pays_paye,
    pays_nssf,
    pays_helb,
    pays_housing_levy,
  } = req.body;

  if (!employee_number || !first_name || !last_name || !salary) {
    return res.status(400).json({ error: "Required fields are missing." });
  }

  try {
    // Ensure the user owns the company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res
        .status(403)
        .json({ error: "Unauthorized to add employee to this company." });
    }

    const { data: newEmployee, error } = await supabase
      .from("employees")
      .insert({
        company_id: companyId,
        department_id,
        employee_number,
        first_name,
        last_name,
        other_names,
        email,
        phone,
        date_of_birth,
        gender,
        date_joined,
        job_title,
        job_type,
        employee_status,
        employee_status_effective_date,
        id_type,
        id_number,
        krapin,
        shif_number,
        nssf_number,
        citizenship,
        has_disability,
        salary,
        employee_type,
        pays_paye,
        pays_nssf,
        pays_helb,
        pays_housing_levy,
      })
      .select()
      .single();

    if (error) {
      console.error("Insert employee error:", error);
      if (error.code === "23505") {
        // Unique violation error (e.g., employee_number, KRA PIN, ID number, email)
        return res.status(409).json({
          error:
            "An employee with similar unique details (Employee No., ID, KRA PIN, Email) already exists.",
        });
      }
      throw new Error("Failed to add employee.");
    }

    // Insert into employee_bank_details after successfully creating the employee
    const { data: bankData, error: bankError } = await supabase
      .from("employee_bank_details")
      .insert([
        {
          employee_id: newEmployee.id, // Use the ID of the newly created employee
          payment_method: "Cash",
        },
      ])
      .select()
      .single();

    if (bankError) {
      console.error("Insert bank details error:", bankError);
      return res
        .status(500)
        .json({ error: "Failed to add employee bank details" });
    }

    res.status(201).json({ employee: newEmployee, bankDetails: bankData });
  } catch (error) {
    console.error("Add employee controller error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Update an existing employee (full update)
export const updateEmployee = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;
  const {
    department_id,
    employee_number,
    first_name,
    last_name,
    other_names,
    email,
    phone,
    date_of_birth,
    gender,
    date_joined,
    job_title,
    job_type,
    employee_status,
    employee_status_effective_date,
    id_type,
    id_number,
    krapin,
    shif_number,
    nssf_number,
    citizenship,
    has_disability,
    salary,
    employee_type,
    pays_paye,
    pays_nssf,
    pays_helb,
    pays_housing_levy,
  } = req.body;

  const validatedDepartmentId = department_id === "" ? null : department_id;

  if (!employee_number || !first_name || !last_name || !salary) {
    return res.status(400).json({ error: "Required fields are missing." });
  }

  try {
    // Ensure the user owns the company and the employee belongs to that company
    const { data: employee, error: employeeCheckError } = await supabase
      .from("employees")
      .select("id, company_id")
      .eq("id", employeeId)
      .eq("company_id", companyId)
      .single();

    if (employeeCheckError || !employee) {
      return res
        .status(403)
        .json({ error: "Unauthorized or employee not found." });
    }

    // Verify user ownership of the company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res
        .status(403)
        .json({ error: "Unauthorized to update employee for this company." });
    }

    const { data, error } = await supabase
      .from("employees")
      .update({
        department_id: validatedDepartmentId,
        employee_number,
        first_name,
        last_name,
        other_names,
        email,
        phone,
        date_of_birth,
        gender,
        date_joined,
        job_title,
        job_type,
        employee_status,
        employee_status_effective_date,
        id_type,
        id_number,
        krapin,
        shif_number,
        nssf_number,
        citizenship,
        has_disability,
        salary,
        employee_type,
        pays_paye,
        pays_nssf,
        pays_helb,
        pays_housing_levy,
        updated_at: new Date().toISOString(),
      })
      .eq("id", employeeId)
      .eq("company_id", companyId) // Ensure only employee for this company is updated
      .select()
      .single();

    if (error) {
      console.error("Update employee error:", error);
      if (error.code === "23505") {
        return res.status(409).json({
          error: "An employee with similar unique details already exists.",
        });
      }
      throw new Error("Failed to update employee.");
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update employee status (specific update)
export const updateEmployeeStatus = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const { employee_status, employee_status_effective_date } = req.body;
  const userId = req.userId;

  if (!employee_status || !employee_status_effective_date) {
    return res
      .status(400)
      .json({ error: "Employee status and effective date are required." });
  }

  try {
    // Ownership checks similar to updateEmployee
    const { data: employee, error: employeeCheckError } = await supabase
      .from("employees")
      .select("id, company_id")
      .eq("id", employeeId)
      .eq("company_id", companyId)
      .single();

    if (employeeCheckError || !employee) {
      return res
        .status(403)
        .json({ error: "Unauthorized or employee not found." });
    }

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res.status(403).json({
        error: "Unauthorized to update employee status for this company.",
      });
    }

    const { data, error } = await supabase
      .from("employees")
      .update({
        employee_status,
        employee_status_effective_date,
        updated_at: new Date().toISOString(),
      })
      .eq("id", employeeId)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error) {
      console.error("Update employee status error:", error);
      throw new Error("Failed to update employee status.");
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update employee salary (specific update)
export const updateEmployeeSalary = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const { salary } = req.body;
  const userId = req.userId;

  if (salary === undefined || salary === null || isNaN(Number(salary))) {
    return res.status(400).json({ error: "Valid salary is required." });
  }

  try {
    // Ownership checks similar to updateEmployee
    const { data: employee, error: employeeCheckError } = await supabase
      .from("employees")
      .select("id, company_id")
      .eq("id", employeeId)
      .eq("company_id", companyId)
      .single();

    if (employeeCheckError || !employee) {
      return res
        .status(403)
        .json({ error: "Unauthorized or employee not found." });
    }

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res.status(403).json({
        error: "Unauthorized to update employee salary for this company.",
      });
    }

    const { data, error } = await supabase
      .from("employees")
      .update({
        salary: parseFloat(salary), // Ensure salary is a number
        updated_at: new Date().toISOString(),
      })
      .eq("id", employeeId)
      .eq("company_id", companyId)
      .select()
      .single();

    if (error) {
      console.error("Update employee salary error:", error);
      throw new Error("Failed to update employee salary.");
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete an employee
export const deleteEmployee = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;

  try {
    // Ownership checks similar to updateEmployee
    const { data: employee, error: employeeCheckError } = await supabase
      .from("employees")
      .select("id, company_id")
      .eq("id", employeeId)
      .eq("company_id", companyId)
      .single();

    if (employeeCheckError || !employee) {
      return res
        .status(403)
        .json({ error: "Unauthorized or employee not found." });
    }

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res
        .status(403)
        .json({ error: "Unauthorized to delete employee from this company." });
    }

    const { error } = await supabase
      .from("employees")
      .delete()
      .eq("id", employeeId)
      .eq("company_id", companyId);

    if (error) {
      console.error("Delete employee error:", error);
      throw new Error("Failed to delete employee.");
    }

    res.status(204).send(); // No Content
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const importEmployees = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  try {
    // Ensure user owns company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res
        .status(403)
        .json({ error: "Unauthorized to import employees to this company." });
    }

    // Get all departments for validation
    const { data: departments, error: deptError } = await supabase
      .from("departments")
      .select("id, name")
      .eq("company_id", companyId);

    if (deptError) {
      console.error("Fetch departments error:", deptError);
      return res
        .status(500)
        .json({ error: "Failed to fetch departments for validation." });
    }

    const departmentMap = departments.reduce((acc, d) => {
      acc[d.name.toLowerCase()] = d.id;
      return acc;
    }, {});

    // Parse Excel
    const workbook = read(req.file.buffer, { type: "buffer" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
      defval: null,
    });

    const headers = jsonData[0].map((h) => h.trim());
    const employeesToInsert = [];
    const errors = [];
    const uniqueValues = {
      employee_number: new Set(),
      email: new Set(),
      id_number: new Set(),
      krapin: new Set(),
    };

    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;

      const employeeData = {};
      headers.forEach((header, index) => {
        const key = header.replace(/\s/g, "_").toLowerCase();
        employeeData[key] = row[index];
      });

      // Required fields
      if (
        !employeeData.employee_number ||
        !employeeData.first_name ||
        !employeeData.last_name ||
        !employeeData.salary
      ) {
        errors.push(
          `Row ${
            i + 1
          }: Missing required fields (Employee Number, First Name, Last Name, Salary).`
        );
        continue;
      }

      // Check uniqueness
      ["employee_number", "email", "id_number"].forEach((field) => {
        const val = employeeData[field];
        if (val) {
          if (uniqueValues[field].has(val)) {
            errors.push(`Row ${i + 1}: Duplicate value for '${field}'.`);
          } else {
            uniqueValues[field].add(val);
          }
        }
      });

      // Correctly check for KRA PIN uniqueness using the correct key.
      const kraPinVal = employeeData.kra_pin;
      if (kraPinVal) {
        if (uniqueValues.krapin.has(kraPinVal)) {
          errors.push(`Row ${i + 1}: Duplicate value for 'kra_pin'.`);
        } else {
          uniqueValues.krapin.add(kraPinVal);
        }
      }

      // Map department
      let departmentId = null;
      if (employeeData.department) {
        const deptKey = employeeData.department.toLowerCase();
        departmentId = departmentMap[deptKey];
        if (!departmentId) {
          errors.push(
            `Row ${i + 1}: Department '${employeeData.department}' not found.`
          );
        }
      }

      // Build employee record
      const record = {
        company_id: companyId,
        department_id: employeeData.department ? departmentMap[employeeData.department.toLowerCase()] || null : null,
        employee_number: employeeData.employee_number.toString(),
        first_name: employeeData.first_name,
        last_name: employeeData.last_name,
        other_names: employeeData.other_names || null,
        email: employeeData.email || null,
        phone: employeeData.phone || null,
        date_of_birth: employeeData['date_of_birth_(yyyy-mm-dd)'] ? parseDate(employeeData['date_of_birth_(yyyy-mm-dd)'], i + 1, "Date of Birth", errors) : null,
        gender: ["male", "female", "other"].includes(
          employeeData.gender?.toLowerCase()
        )
          ? employeeData.gender
          : null,
        date_joined: employeeData['date_joined_(yyyy-mm-dd)'] ? parseDate(employeeData['date_joined_(yyyy-mm-dd)'], i + 1, "Date Joined", errors) : new Date().toISOString().split("T")[0],
        job_title: employeeData.job_title || null,
        job_type: ["full-time", "part-time", "contract", "internship"].includes(
          employeeData.job_type?.toLowerCase()
        )
          ? employeeData.job_type
          : null,
        employee_status: [
          "active",
          "on leave",
          "terminated",
          "suspended",
        ].includes(employeeData.employee_status?.toLowerCase())
          ? employeeData.employee_status
          : "Active",
        employee_status_effective_date: employeeData['employee_status_effective_date_(yyyy-mm-dd)'] ? parseDate(employeeData['employee_status_effective_date_(yyyy-mm-dd)'], i + 1, "Employee Status Effective Date", errors) : new Date().toISOString().split("T")[0],
        id_type: ["national id", "passport"].includes(
          employeeData.id_type?.toLowerCase()
        )
          ? employeeData.id_type
          : null,
        id_number: employeeData.id_number?.toString() || null,
        krapin: employeeData.kra_pin ? String(employeeData.kra_pin).trim() : null,
        shif_number: employeeData.shif_number?.toString() || null,
        nssf_number: employeeData.nssf_number?.toString() || null,
        citizenship: ["kenyan", "non-kenyan"].includes(
          employeeData.citizenship?.toLowerCase()
        )
          ? employeeData.citizenship
          : null,
        has_disability: parseYesNo(employeeData.has_disability),
        salary: parseFloat(employeeData.salary) || 0,
        employee_type: ["primary employee", "secondary employee"].includes(
          employeeData.employee_type?.toLowerCase()
        )
          ? employeeData.employee_type
          : null,
        pays_paye: parseNoDefaultYes(employeeData.pays_paye),
        pays_nssf: parseNoDefaultYes(employeeData.pays_nssf),
        pays_helb: parseYesNo(employeeData.pays_helb),
        pays_housing_levy: parseNoDefaultYes(employeeData.pays_housing_levy),
      };

      employeesToInsert.push(record);
    }

    if (errors.length > 0) {
      return res
        .status(400)
        .json({ error: "Validation failed.", details: errors });
    }

    // Insert employees
    const { data, error } = await supabase
      .from("employees")
      .upsert(employeesToInsert, {
        onConflict: "company_id, employee_number",
        ignoreDuplicates: false, // Ensures all data is considered for upsert
      })
      .select();

    if (error) {
      console.error("Bulk upsert employee error:", error);
      // Handle unique constraint errors if they still occur from existing DB data
      if (error.code === '23505') {
        const uniqueKey = error.details.match(/\((.*?)\)=\(.*?\)/)[1];
        return res.status(409).json({ error: `A record with a duplicate unique key already exists in the database: ${uniqueKey}.` });
      }
      return res.status(500).json({ error: "Failed to import employees.", details: error.message });
    }

    // After successful upsert, send a welcome email to each new employee
    // You can get the company name from the companyId or a request body
    const { data: companyData } = await supabase.from('companies').select('business_name').eq('id', companyId).single();
    const companyName = companyData ? companyData.business_name : 'Your Company';

    // Loop through the upserted employees and send the email
    for (const employee of data) {
      if (employee.email) {
        // You'll need to check if the employee was newly inserted or updated.
        // For simplicity, we send a welcome email to all. A more advanced
        // implementation would only send it on new insertions.
        await sendWelcomeEmail(employee.email, `${employee.first_name} ${employee.last_name}`, companyName);
      }
    }

    // Add default bank details
    const employeeBankDetails = data.map((emp) => ({
      employee_id: emp.id,
      payment_method: "Cash",
    }));

    const { error: bankError } = await supabase
      .from("employee_bank_details")
      .upsert(employeeBankDetails, { onConflict: "employee_id" });

    if (bankError) {
      console.error("Bank insert error:", bankError);
      return res
        .status(500)
        .json({ error: "Employees added, but failed to insert/update bank details.", details: bankError.message });
    }

    res
      .status(201)
      .json({
        message: `${data.length} employees imported successfully.`,
        importedEmployees: data,
      });
  } catch (err) {
    console.error("Import employees controller error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const generateEmployeeTemplate = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    // 1. Ensure the user owns the company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("id", companyId)
      .eq("user_id", userId)
      .single();

    if (companyError || !company) {
      return res
        .status(403)
        .json({ error: "Unauthorized to access this company." });
    }

    // 2. Fetch departments from Supabase
    const { data: departments, error: deptError } = await supabase
      .from("departments")
      .select("name")
      .eq("company_id", companyId)
      .order("name");

    if (deptError) {
      console.error("Departments fetch error:", deptError);
      throw new Error("Failed to fetch departments.");
    }

    // --- HEADERS ---
    const templateHeaders = [
      "Employee Number",
      "First Name",
      "Last Name",
      "Other Names",
      "Email",
      "Phone",
      "Date of Birth (YYYY-MM-DD)",
      "Gender",
      "Date Joined (YYYY-MM-DD)",
      "Job Title",
      "Job Type",
      "Employee Status",
      "Employee Status Effective Date (YYYY-MM-DD)",
      "ID Type",
      "ID Number",
      "KRA PIN",
      "SHIF Number",
      "NSSF Number",
      "Citizenship",
      "Has Disability",
      "Salary",
      "Employee Type",
      "Pays PAYE",
      "Pays NSSF",
      "Pays HELB",
      "Pays Housing Levy",
      "Department",
    ];

    // --- DROPDOWNS ---
    const dropdownOptions = {
      Gender: ["Male", "Female", "Other"],
      Citizenship: ["Kenyan", "Non-Kenyan"],
      "Job Type": ["Full-time", "Part-time", "Contract", "Internship"],
      "Employee Type": ["Primary Employee", "Secondary Employee"],
      "ID Type": ["National ID", "Passport"],
      "Employee Status": ["Active", "On Leave", "Terminated", "Suspended"],
      "Has Disability": ["Yes", "No"],
      "Pays PAYE": ["Yes", "No"],
      "Pays NSSF": ["Yes", "No"],
      "Pays HELB": ["Yes", "No"],
      "Pays Housing Levy": ["Yes", "No"],
      Department: departments?.map((d) => d.name) || [],
    };

    // 3. Create workbook & worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Employees");

    // 4. Add header row
    const headerRow = worksheet.addRow(templateHeaders);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD9E1F2" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    worksheet.columns.forEach((column, index) => {
      const header = templateHeaders[index];
      column.width = header.length < 15 ? 15 : header.length + 5;

      if (
        header.startsWith("Date of Birth") ||
        header.startsWith("Date Joined") ||
        header.startsWith("Employee Status Effective Date")
      ) {
        column.numFmt = "yyyy-mm-dd";
      }
    });
    // 5. Add dropdowns dynamically (up to 500 rows)
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

    // 8. Stream workbook to response
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Employee_Import_Template.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error generating employee template:", error);
    res.status(500).json({ error: error.message });
  }
};

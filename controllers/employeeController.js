// backend/controllers/employeeController.js
import supabase from "../libs/supabaseClient.js";
import { parse} from "xlsx";

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
        return res
          .status(409)
          .json({
            error:
              "An employee with similar unique details (Employee No., ID, KRA PIN, Email) already exists.",
          });
      }
      throw new Error("Failed to add employee.");
    }

   // Insert into employee_bank_details after successfully creating the employee
    const { data: bankData, error: bankError } = await supabase
      .from('employee_bank_details')
      .insert([
        {
          employee_id: newEmployee.id, // Use the ID of the newly created employee
          payment_method: 'Cash',
        },
      ])
      .select()
      .single();

    if (bankError) {
      console.error('Insert bank details error:', bankError);
      return res.status(500).json({ error: 'Failed to add employee bank details' });
    }

    res.status(201).json({ employee: newEmployee, bankDetails: bankData });
  } catch (error) {
    console.error('Add employee controller error:', error);
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
        updated_at: new Date().toISOString(),
      })
      .eq("id", employeeId)
      .eq("company_id", companyId) // Ensure only employee for this company is updated
      .select()
      .single();

    if (error) {
      console.error("Update employee error:", error);
      if (error.code === "23505") {
        return res
          .status(409)
          .json({
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
      return res
        .status(403)
        .json({
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
      return res
        .status(403)
        .json({
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
        return res.status(400).json({ error: 'No file uploaded.' });
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
            return res.status(403).json({ error: "Unauthorized to import employees to this company." });
        }

        // Get all departments for validation
        const { data: departments, error: departmentsError } = await supabase
            .from("departments")
            .select("id, name")
            .eq("company_id", companyId);

        if (departmentsError) {
            console.error("Fetch departments error:", departmentsError);
            return res.status(500).json({ error: "Failed to fetch departments for validation." });
        }

        const departmentMap = departments.reduce((acc, dept) => {
            acc[dept.name.toLowerCase()] = dept.id;
            return acc;
        }, {});

        const workbook = parse(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = parse(worksheet, { header: 1, raw: false }); // get data as an array of arrays

        // Assuming the first row is headers, process from the second row
        const headers = jsonData[0].map(h => h.trim());
        const employeesToInsert = [];
        const uniqueValues = { employee_number: new Set(), email: new Set(), id_number: new Set(), krapin: new Set() };
        const errors = [];

        for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            const employeeData = {};

            headers.forEach((header, index) => {
                const key = header.replace(/\s/g, '_').toLowerCase();
                employeeData[key] = row[index];
            });

            // Basic validation and data mapping
            if (!employeeData.employee_number || !employeeData.first_name || !employeeData.last_name || !employeeData.salary) {
                errors.push(`Row ${i + 1}: Required fields (Employee Number, First Name, Last Name, Salary) are missing.`);
                continue;
            }

            // Check for uniqueness
            ['employee_number', 'email', 'id_number', 'krapin'].forEach(field => {
                const value = employeeData[field];
                if (value && uniqueValues[field].has(value)) {
                    errors.push(`Row ${i + 1}: Duplicate value found for '${field}'.`);
                } else if (value) {
                    uniqueValues[field].add(value);
                }
            });

            // Map department name to ID
            const departmentName = employeeData.department?.toLowerCase();
            const departmentId = departmentName ? departmentMap[departmentName] : null;

            if (employeeData.department && !departmentId) {
                errors.push(`Row ${i + 1}: Department '${employeeData.department}' not found.`);
            }

            // Clean up and format data for insertion
            const employeeRecord = {
                company_id: companyId,
                department_id: departmentId,
                employee_number: employeeData.employee_number.toString(),
                first_name: employeeData.first_name,
                last_name: employeeData.last_name,
                other_names: employeeData.other_names || null,
                email: employeeData.email || null,
                phone: employeeData.phone || null,
                date_of_birth: employeeData.date_of_birth ? new Date(employeeData.date_of_birth) : null,
                gender: ['male', 'female', 'other'].includes(employeeData.gender?.toLowerCase()) ? employeeData.gender : null,
                date_joined: employeeData.date_joined ? new Date(employeeData.date_joined) : new Date(),
                job_title: employeeData.job_title || null,
                job_type: ['full-time', 'part-time', 'contract', 'internship'].includes(employeeData.job_type?.toLowerCase()) ? employeeData.job_type : null,
                employee_status: ['active', 'on leave', 'terminated', 'suspended'].includes(employeeData.employee_status?.toLowerCase()) ? employeeData.employee_status : 'Active',
                employee_status_effective_date: employeeData.employee_status_effective_date ? new Date(employeeData.employee_status_effective_date) : new Date(),
                id_type: ['national id', 'passport'].includes(employeeData.id_type?.toLowerCase()) ? employeeData.id_type : null,
                id_number: employeeData.id_number?.toString() || null,
                krapin: employeeData.krapin?.toString() || null,
                shif_number: employeeData.shif_number?.toString() || null,
                nssf_number: employeeData.nssf_number?.toString() || null,
                citizenship: ['kenyan', 'non-kenyan'].includes(employeeData.citizenship?.toLowerCase()) ? employeeData.citizenship : null,
                has_disability: employeeData.has_disability?.toLowerCase() === 'yes',
                salary: parseFloat(employeeData.salary),
                employee_type: ['primaryemployee', 'secondary employee'].includes(employeeData.employee_type?.toLowerCase()) ? employeeData.employee_type : null,
                pays_paye: employeeData.pays_paye?.toLowerCase() === 'no' ? false : true,
                pays_nssf: employeeData.pays_nssf?.toLowerCase() === 'no' ? false : true,
                pays_helb: employeeData.pays_helb?.toLowerCase() === 'yes' ? true : false,
                pays_housing_levy: employeeData.pays_housing_levy?.toLowerCase() === 'no' ? false : true,
            };

            employeesToInsert.push(employeeRecord);
        }

        if (errors.length > 0) {
            return res.status(400).json({ error: 'Validation failed.', details: errors });
        }

        // Perform bulk insertion
        const { data, error } = await supabase
            .from("employees")
            .insert(employeesToInsert)
            .select();

        if (error) {
            console.error("Bulk insert employee error:", error);
            if (error.code === "23505") { // Unique violation
                return res.status(409).json({ error: "One or more employee unique details (Employee No., ID, KRA PIN, Email) already exist in the database." });
            }
            throw new Error("Failed to import employees.");
        }

        // Prepare bank details for insertion
        const employeeBankDetailsToInsert = data.map(employee => ({
            employee_id: employee.id,
            payment_method: 'Cash',
        }));

        // Insert employee bank details
        const { error: bankError } = await supabase
            .from('employee_bank_details')
            .insert(employeeBankDetailsToInsert);

        if (bankError) {
            console.error('Insert bulk bank details error:', bankError);
            return res.status(500).json({ error: 'Failed to add employee bank details for some records.' });
        }

        res.status(201).json({ message: `${data.length} employees imported successfully.`, importedEmployees: data });

    } catch (error) {
        console.error('Import employees controller error:', error);
        res.status(500).json({ error: error.message });
    }
};

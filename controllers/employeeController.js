// backend/controllers/employeeController.js
import supabase from '../libs/supabaseClient.js'

// Get all employees for a specific company
export const getEmployees = async (req, res) => {
    const { companyId } = req.params;
    const userId = req.userId;

    try {
        // Ensure the user owns the company
        const { data: company, error: companyError } = await supabase
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .eq('user_id', userId)
            .single();

        if (companyError || !company) {
            return res.status(403).json({ error: 'Unauthorized to access employees for this company.' });
        }

        const { data, error } = await supabase
            .from('employees')
            .select(`
                *,
                departments (
                    name
                )
            `) // Select all employee fields and department name
            .eq('company_id', companyId);

        if (error) {
            console.error('Fetch employees error:', error);
            throw new Error('Failed to fetch employees.');
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
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .eq('user_id', userId)
            .single();

        if (companyError || !company) {
            return res.status(403).json({ error: 'Unauthorized to access this employee.' });
        }

        const { data, error } = await supabase
            .from('employees')
            .select(`
                *,
                departments (
                    name
                )
            `)
            .eq('id', employeeId)
            .eq('company_id', companyId)
            .single();

        if (error) {
            console.error('Fetch employee by ID error:', error);
            if (error.code === 'PGRST116') { // No rows found
                return res.status(404).json({ error: 'Employee not found.' });
            }
            throw new Error('Failed to fetch employee details.');
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
        employee_number, first_name, last_name, other_names, email, phone,
        date_of_birth, gender, date_joined, job_title, department_id, job_type,
        employee_status, employee_status_effective_date, id_type, id_number,
        krapin, shif_number, nssf_number, citizenship, has_disability, salary,
        employee_type, pays_paye, pays_nssf, pays_helb, pays_housing_levy
    } = req.body;

    if (!employee_number || !first_name || !last_name || !salary) {
        return res.status(400).json({ error: 'Required fields are missing.' });
    }

    try {
        // Ensure the user owns the company
        const { data: company, error: companyError } = await supabase
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .eq('user_id', userId)
            .single();

        if (companyError || !company) {
            return res.status(403).json({ error: 'Unauthorized to add employee to this company.' });
        }

        const { data, error } = await supabase
            .from('employees')
            .insert({
                company_id: companyId,
                department_id, employee_number, first_name, last_name, other_names, email, phone,
                date_of_birth, gender, date_joined, job_title, job_type,
                employee_status, employee_status_effective_date, id_type, id_number,
                krapin, shif_number, nssf_number, citizenship, has_disability, salary,
                employee_type, pays_paye, pays_nssf, pays_helb, pays_housing_levy
            })
            .select()
            .single();

        if (error) {
            console.error('Insert employee error:', error);
            if (error.code === '23505') { // Unique violation error (e.g., employee_number, KRA PIN, ID number, email)
                return res.status(409).json({ error: 'An employee with similar unique details (Employee No., ID, KRA PIN, Email) already exists.' });
            }
            throw new Error('Failed to add employee.');
        }

        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update an existing employee (full update)
export const updateEmployee = async (req, res) => {
    const { companyId, employeeId } = req.params;
    const userId = req.userId;
    const {
        department_id, employee_number, first_name, last_name, other_names, email, phone,
        date_of_birth, gender, date_joined, job_title, job_type,
        employee_status, employee_status_effective_date, id_type, id_number,
        krapin, shif_number, nssf_number, citizenship, has_disability, salary,
        employee_type, pays_paye, pays_nssf, pays_helb, pays_housing_levy
    } = req.body;

    if (!employee_number || !first_name || !last_name || !salary) {
        return res.status(400).json({ error: 'Required fields are missing.' });
    }

    try {
        // Ensure the user owns the company and the employee belongs to that company
        const { data: employee, error: employeeCheckError } = await supabase
            .from('employees')
            .select('id, company_id')
            .eq('id', employeeId)
            .eq('company_id', companyId)
            .single();

        if (employeeCheckError || !employee) {
            return res.status(403).json({ error: 'Unauthorized or employee not found.' });
        }

        // Verify user ownership of the company
        const { data: company, error: companyError } = await supabase
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .eq('user_id', userId)
            .single();

        if (companyError || !company) {
            return res.status(403).json({ error: 'Unauthorized to update employee for this company.' });
        }
        
        const { data, error } = await supabase
            .from('employees')
            .update({
                department_id, employee_number, first_name, last_name, other_names, email, phone,
                date_of_birth, gender, date_joined, job_title, job_type,
                employee_status, employee_status_effective_date, id_type, id_number,
                krapin, shif_number, nssf_number, citizenship, has_disability, salary,
                employee_type, pays_paye, pays_nssf, pays_helb, pays_housing_levy,
                updated_at: new Date().toISOString()
            })
            .eq('id', employeeId)
            .eq('company_id', companyId) // Ensure only employee for this company is updated
            .select()
            .single();

        if (error) {
            console.error('Update employee error:', error);
            if (error.code === '23505') {
                return res.status(409).json({ error: 'An employee with similar unique details already exists.' });
            }
            throw new Error('Failed to update employee.');
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
        return res.status(400).json({ error: 'Employee status and effective date are required.' });
    }

    try {
        // Ownership checks similar to updateEmployee
        const { data: employee, error: employeeCheckError } = await supabase
            .from('employees')
            .select('id, company_id')
            .eq('id', employeeId)
            .eq('company_id', companyId)
            .single();

        if (employeeCheckError || !employee) {
            return res.status(403).json({ error: 'Unauthorized or employee not found.' });
        }

        const { data: company, error: companyError } = await supabase
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .eq('user_id', userId)
            .single();

        if (companyError || !company) {
            return res.status(403).json({ error: 'Unauthorized to update employee status for this company.' });
        }

        const { data, error } = await supabase
            .from('employees')
            .update({
                employee_status,
                employee_status_effective_date,
                updated_at: new Date().toISOString()
            })
            .eq('id', employeeId)
            .eq('company_id', companyId)
            .select()
            .single();

        if (error) {
            console.error('Update employee status error:', error);
            throw new Error('Failed to update employee status.');
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
        return res.status(400).json({ error: 'Valid salary is required.' });
    }

    try {
        // Ownership checks similar to updateEmployee
        const { data: employee, error: employeeCheckError } = await supabase
            .from('employees')
            .select('id, company_id')
            .eq('id', employeeId)
            .eq('company_id', companyId)
            .single();

        if (employeeCheckError || !employee) {
            return res.status(403).json({ error: 'Unauthorized or employee not found.' });
        }

        const { data: company, error: companyError } = await supabase
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .eq('user_id', userId)
            .single();

        if (companyError || !company) {
            return res.status(403).json({ error: 'Unauthorized to update employee salary for this company.' });
        }

        const { data, error } = await supabase
            .from('employees')
            .update({
                salary: parseFloat(salary), // Ensure salary is a number
                updated_at: new Date().toISOString()
            })
            .eq('id', employeeId)
            .eq('company_id', companyId)
            .select()
            .single();

        if (error) {
            console.error('Update employee salary error:', error);
            throw new Error('Failed to update employee salary.');
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
            .from('employees')
            .select('id, company_id')
            .eq('id', employeeId)
            .eq('company_id', companyId)
            .single();

        if (employeeCheckError || !employee) {
            return res.status(403).json({ error: 'Unauthorized or employee not found.' });
        }

        const { data: company, error: companyError } = await supabase
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .eq('user_id', userId)
            .single();

        if (companyError || !company) {
            return res.status(403).json({ error: 'Unauthorized to delete employee from this company.' });
        }

        const { error } = await supabase
            .from('employees')
            .delete()
            .eq('id', employeeId)
            .eq('company_id', companyId);

        if (error) {
            console.error('Delete employee error:', error);
            throw new Error('Failed to delete employee.');
        }

        res.status(204).send(); // No Content
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

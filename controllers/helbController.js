import supabase from '../libs/supabaseClient.js';

// Helper function to check for company ownership
const checkCompanyOwnership = async (companyId, userId) => {
  const { data: company, error } = await supabase
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .eq('user_id', userId)
    .single();

  if (error || !company) {
    return false;
  }
  return true;
};

// CREATE: Add a new HELB record and update the employee's pays_helb flag
export const createHelbRecord = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;
  const { helb_account_number, initial_balance, monthly_deduction } = req.body;

  if (!helb_account_number || initial_balance === undefined || monthly_deduction === undefined) {
    return res.status(400).json({ error: 'All required fields must be provided.' });
  }

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to access this company.' });
    }

    const { data: helbData, error: helbError } = await supabase
      .from('helb_deductions')
      .insert({
        company_id: companyId,
        employee_id: employeeId,
        helb_account_number,
        initial_balance,
        current_balance: initial_balance, // Initialize current_balance with initial_balance
        monthly_deduction,
        status: 'Active'
      })
      .select()
      .single();

    if (helbError) {
        throw new Error(`Failed to create HELB record: ${helbError.message}`);
    }

    // Update the employee's pays_helb flag to true
    const { data: employeeData, error: employeeError } = await supabase
      .from('employees')
      .update({ pays_helb: true })
      .eq('id', employeeId)
      .eq('company_id', companyId)
      .select()
      .single();

      if (employeeError) {
        // Log the error but don't fail the entire request, as the HELB record was already created.
        console.error('Failed to update employee pays_helb flag:', employeeError);
    }

    res.status(201).json(helbData);
  } catch (err) {
    console.error('Create HELB record error:', err);
    res.status(500).json({ error: err.message || 'Failed to create HELB record.' });
  }
};

// GET ONE
export const getHelbRecord = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to access this HELB record.' });
    }

    const { data, error } = await supabase
      .from('helb_deductions')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('company_id', companyId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') { // No rows found
        return res.status(404).json({ error: 'HELB record not found for this employee.' });
      }
      throw error;
    }
    
    res.status(200).json(data || {});
  } catch (error) {
    console.error('Get HELB record error:', error);
    res.status(500).json({ error: 'Failed to get HELB record.' });
  }
};

// GET: Get all HELB records for a company, joining with employee data
export const getCompanyHelbRecords = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to access this company.' });
    }

    // Join the helb_deductions table with the employees table to get names
    const { data, error } = await supabase
      .from('helb_deductions')
      .select('*, employees(first_name, last_name, employee_number)')
      .eq('company_id', companyId);

    if (error) throw error;

    // Flatten the data for easier use on the frontend
    const flattenedData = data.map(record => ({
      ...record,
      first_name: record.employees.first_name,
      last_name: record.employees.last_name,
      employee_number: record.employees.employee_number,
      employees: undefined // Remove the nested employees object
    }));

    res.status(200).json(flattenedData);
  } catch (err) {
    console.error('Fetch company HELB records error:', err);
    res.status(500).json({ error: 'Failed to fetch company HELB records.' });
  }
};

// UPDATE
export const updateHelbRecord = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;
  const { monthly_deduction, is_active } = req.body;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to update this HELB record.' });
    }

    const { data, error } = await supabase
      .from('helb_deductions')
      .update({ monthly_deduction, is_active })
      .eq('employee_id', employeeId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update HELB record' });
  }
};

// DELETE
export const deleteHelbRecord = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to delete this HELB record.' });
    }

    // First, delete the HELB record
    const { error: deleteError } = await supabase
      .from('helb_deductions')
      .delete()
      .eq('employee_id', employeeId)
      .eq('company_id', companyId);

    if (deleteError) {
      throw new Error(`Failed to delete HELB record: ${deleteError.message}`);
    }

    // Then, update the employee's pays_helb flag back to false
    const { error: employeeError } = await supabase
      .from('employees')
      .update({ pays_helb: false })
      .eq('id', employeeId)
      .eq('company_id', companyId);

    if (employeeError) {
      console.error('Failed to update employee pays_helb flag after deletion:', employeeError);
    }

     res.status(200).json({ message: 'HELB record deleted successfully.' });
  } catch (err) {
    console.error('Delete HELB record error:', err);
    res.status(500).json({ error: 'Failed to delete HELB record.' });
  }
};
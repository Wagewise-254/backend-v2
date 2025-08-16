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

// Get statutory deduction flags for all employees in a company
export const getCompanyStatutories = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to access this company.' });
    }

    const { data, error } = await supabase
      .from('employees')
      .select('id, first_name, last_name, pays_paye, pays_nssf, pays_shif, pays_housing_levy, pays_helb')
      .eq('company_id', companyId);

    if (error) throw error;

    res.status(200).json(data);
  } catch (err) {
    console.error('Fetch company statutory deductions error:', err);
    res.status(500).json({ error: 'Failed to fetch statutory data.' });
  }
};

// Get statutory flags for one employee
export const getEmployeeStatutories = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const { data, error } = await supabase
      .from('employees')
      .select('id, first_name, last_name, pays_paye, pays_nssf, pays_shif, pays_housing_levy, pays_helb')
      .eq('company_id', companyId)
      .eq('id', employeeId)
      .single();

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    console.error('Fetch employee statutory deductions error:', err);
    res.status(500).json({ error: 'Failed to fetch employee statutory data.' });
  }
};

// Update statutory flags for one employee
export const updateEmployeeStatutories = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;
  const { pays_paye, pays_nssf, pays_shif, pays_housing_levy, pays_helb } = req.body;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to update statutory data for this company.' });
    }

    const { data, error } = await supabase
      .from('employees')
      .update({ pays_paye, pays_nssf, pays_shif, pays_housing_levy, pays_helb })
      .eq('company_id', companyId)
      .eq('id', employeeId)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json(data);
  } catch (err) {
    console.error('Update employee statutory deductions error:', err);
    res.status(500).json({ error: 'Failed to update employee statutory data.' });
  }
};
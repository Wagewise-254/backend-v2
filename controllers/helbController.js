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

// CREATE
export const createHelbRecord = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;
  const { helb_account_number, initial_balance, monthly_deduction } = req.body;

  if (!helb_account_number || !initial_balance || !monthly_deduction) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to access this company.' });
    }

    const { data, error } = await supabase
      .from('helb_deductions')
      .insert({
        company_id: companyId,
        employee_id: employeeId,
        helb_account_number,
        initial_balance,
        current_balance: initial_balance,
        monthly_deduction,
        status: 'Active',
      })
      .select()
      .single();

    if (error) throw error;

    await supabase
      .from('employees')
      .update({ pays_helb: true })
      .eq('id', employeeId);

    res.status(201).json(data);
  } catch (error) {
    console.error('Create HELB record error:', error);
    res.status(500).json({ error: 'Failed to create HELB record.' });
  }
};

// GET ONE
export const getHelbRecord = async (req, res) => {
  const { companyId, employeeId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const { data, error } = await supabase
      .from('helb_deductions')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('company_id', companyId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    
    res.status(200).json(data || {});
  } catch (error) {
    console.error('Get HELB record error:', error);
    res.status(500).json({ error: 'Failed to get HELB record.' });
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

    const { error } = await supabase
      .from('helb_deductions')
      .delete()
      .eq('employee_id', employeeId)
      .eq('company_id', companyId);

    if (error) throw error;

    await supabase
      .from('employees')
      .update({ pays_helb: false })
      .eq('id', employeeId);

    res.json({ message: 'HELB record deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete HELB record' });
  }
};
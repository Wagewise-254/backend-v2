import supabase from '../libs/supabaseClient.js';

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

// ASSIGN
export const assignAllowance = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const { allowance_type_id, employee_id, department_id, value, calculation_type, start_date, end_date } = req.body;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to assign allowance for this company.' });
    }

    const { data, error } = await supabase
      .from('allowances')
      .insert([{ company_id: companyId, allowance_type_id, employee_id, department_id, value, calculation_type, start_date, end_date }])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign allowance' });
  }
};

// GET ALL
export const getAllowances = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to fetch allowances for this company.' });
    }

    const { data, error } = await supabase
      .from('allowances')
      .select('*, allowance_types(name, is_cash, is_taxable), employees(first_name, last_name)')
      .eq('company_id', companyId);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch allowances' });
  }
};

// GET ONE
export const getAllowanceById = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to access this allowance.' });
    }

    const { data, error } = await supabase
      .from('allowances')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(404).json({ error: 'Allowance not found' });
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
      return res.status(403).json({ error: 'Unauthorized to update this allowance.' });
    }

    const { data, error } = await supabase
      .from('allowances')
      .update({ value, calculation_type, start_date, end_date, is_active })
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update allowance' });
  }
};

// REMOVE
export const removeAllowance = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to remove this allowance.' });
    }

    const { error } = await supabase
      .from('allowances')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);
    if (error) throw error;
    res.json({ message: 'Allowance removed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove allowance' });
  }
};
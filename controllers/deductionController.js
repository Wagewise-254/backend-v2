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
export const assignDeduction = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;
  const { deduction_type_id, employee_id, department_id, value, calculation_type, is_one_time = false, start_date, end_date } = req.body;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to assign deduction for this company.' });
    }

    const { data, error } = await supabase
      .from('deductions')
      .insert([{ company_id: companyId, deduction_type_id, employee_id, department_id, value, calculation_type, is_one_time, start_date, end_date }])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign deduction' });
  }
};

// GET ALL
export const getDeductions = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to fetch deductions for this company.' });
    }

    const { data, error } = await supabase
      .from('deductions')
      .select('*, deduction_types(name, is_tax_deductible), employees(first_name, last_name)')
      .eq('company_id', companyId);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch deductions' });
  }
};

// GET ONE
export const getDeductionById = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to access this deduction.' });
    }

    const { data, error } = await supabase.from('deductions')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(404).json({ error: 'Deduction not found' });
  }
};

// UPDATE
export const updateDeduction = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;
  const { value, calculation_type, start_date, end_date, is_active, is_one_time } = req.body;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to update this deduction.' });
    }

    const { data, error } = await supabase
      .from('deductions')
      .update({ value, calculation_type, start_date, end_date, is_active, is_one_time })
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update deduction' });
  }
};

// REMOVE
export const removeDeduction = async (req, res) => {
  const { companyId, id } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to remove this deduction.' });
    }

    const { error } = await supabase.from('deductions')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);
    if (error) throw error;
    res.json({ message: 'Deduction removed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove deduction' });
  }
};
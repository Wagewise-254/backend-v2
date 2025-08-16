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

// CREATE
export const createDeductionType = async (req, res) => {
  const { companyId } = req.params;
  const { name, description, is_tax_deductible = false } = req.body;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to manage deduction types for this company.' });
    }

    const { data, error } = await supabase
      .from('deduction_types')
      .insert([{ company_id: companyId, name, description, is_tax_deductible }])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create deduction type' });
  }
};

// READ ALL
export const getDeductionTypes = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to fetch deduction types for this company.' });
    }

    const { data, error } = await supabase
      .from('deduction_types')
      .select('*')
      .eq('company_id', companyId);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch deduction types' });
  }
};

// READ ONE
export const getDeductionTypeById = async (req, res) => {
  const { id, companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to access this deduction type.' });
    }

    const { data, error } = await supabase
      .from('deduction_types')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(404).json({ error: 'Deduction type not found' });
  }
};

// UPDATE
export const updateDeductionType = async (req, res) => {
  const { id, companyId } = req.params;
  const { name, description, is_tax_deductible } = req.body;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to update this deduction type.' });
    }

    const { data, error } = await supabase
      .from('deduction_types')
      .update({ name, description, is_tax_deductible })
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update deduction type' });
  }
};

// DELETE
export const deleteDeductionType = async (req, res) => {
  const { id, companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to delete this deduction type.' });
    }

    const { error } = await supabase
      .from('deduction_types')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);
    if (error) throw error;
    res.json({ message: 'Deduction type deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete deduction type' });
  }
};
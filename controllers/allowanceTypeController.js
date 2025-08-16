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
export const createAllowanceType = async (req, res) => {
  const { companyId } = req.params;
  const { name, description, is_cash = true, is_taxable = true } = req.body;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to manage allowance types for this company.' });
    }

    const { data, error } = await supabase
      .from('allowance_types')
      .insert([{ company_id: companyId, name, description, is_cash, is_taxable }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('Create allowance type error:', err);
    res.status(500).json({ error: 'Failed to create allowance type' });
  }
};

// READ ALL
export const getAllowanceTypes = async (req, res) => {
  const { companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to access allowance types for this company.' });
    }

    const { data, error } = await supabase
      .from('allowance_types')
      .select('*')
      .eq('company_id', companyId);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch allowance types' });
  }
};

// READ ONE
export const getAllowanceTypeById = async (req, res) => {
  const { id, companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to access this allowance type.' });
    }

    const { data, error } = await supabase
      .from('allowance_types')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(404).json({ error: 'Allowance type not found' });
  }
};

// UPDATE
export const updateAllowanceType = async (req, res) => {
  const { id, companyId } = req.params;
  const { name, description, is_cash, is_taxable } = req.body;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to update this allowance type.' });
    }

    const { data, error } = await supabase
      .from('allowance_types')
      .update({ name, description, is_cash, is_taxable })
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update allowance type' });
  }
};

// DELETE
export const deleteAllowanceType = async (req, res) => {
  const { id, companyId } = req.params;
  const userId = req.userId;

  try {
    const isAuthorized = await checkCompanyOwnership(companyId, userId);
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized to delete this allowance type.' });
    }

    const { error } = await supabase
      .from('allowance_types')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ message: 'Allowance type deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete allowance type' });
  }
};
// backend/controllers/departmentController.js
import supabase from '../libs/supabaseClient.js'

// Get all departments for a specific company
export const getDepartments = async (req, res) => {
    const { companyId } = req.params; // Get companyId from URL parameter
    const userId = req.userId; // From auth middleware

    try {
        // Ensure the user owns the company before fetching departments
        const { data: company, error: companyError } = await supabase
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .eq('user_id', userId)
            .single();

        if (companyError || !company) {
            return res.status(403).json({ error: 'Unauthorized to access departments for this company.' });
        }

        const { data, error } = await supabase
            .from('departments')
            .select('*')
            .eq('company_id', companyId);

        if (error) {
            console.error('Fetch departments error:', error);
            throw new Error('Failed to fetch departments.');
        }

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Add a new department
export const addDepartment = async (req, res) => {
    const { companyId } = req.params;
    const { name, description } = req.body;
    const userId = req.userId;

    if (!name) {
        return res.status(400).json({ error: 'Department name is required.' });
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
            return res.status(403).json({ error: 'Unauthorized to add department to this company.' });
        }

        const { data, error } = await supabase
            .from('departments')
            .insert({ company_id: companyId, name, description })
            .select()
            .single();

        if (error) {
            console.error('Insert department error:', error);
            if (error.code === '23505') { // Unique violation error code
                return res.status(409).json({ error: 'A department with this name already exists for this company.' });
            }
            throw new Error('Failed to add department.');
        }

        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update an existing department
export const updateDepartment = async (req, res) => {
    const { companyId, departmentId } = req.params;
    const { name, description } = req.body;
    const userId = req.userId;

    if (!name) {
        return res.status(400).json({ error: 'Department name is required.' });
    }

    try {
        // Ensure the user owns the company and the department belongs to that company
        const { data: department, error: departmentCheckError } = await supabase
            .from('departments')
            .select('id, company_id')
            .eq('id', departmentId)
            .eq('company_id', companyId)
            .single();

        if (departmentCheckError || !department) {
            return res.status(403).json({ error: 'Unauthorized or department not found.' });
        }

        // Verify user ownership of the company
        const { data: company, error: companyError } = await supabase
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .eq('user_id', userId)
            .single();

        if (companyError || !company) {
            return res.status(403).json({ error: 'Unauthorized to update department for this company.' });
        }

        const { data, error } = await supabase
            .from('departments')
            .update({ name, description, updated_at: new Date().toISOString() })
            .eq('id', departmentId)
            .eq('company_id', companyId) // Ensure only department for this company is updated
            .select()
            .single();

        if (error) {
            console.error('Update department error:', error);
            if (error.code === '23505') {
                return res.status(409).json({ error: 'A department with this name already exists for this company.' });
            }
            throw new Error('Failed to update department.');
        }

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Delete a department
export const deleteDepartment = async (req, res) => {
    const { companyId, departmentId } = req.params;
    const userId = req.userId;

    try {
        // Ensure the user owns the company and the department belongs to that company
        const { data: department, error: departmentCheckError } = await supabase
            .from('departments')
            .select('id, company_id')
            .eq('id', departmentId)
            .eq('company_id', companyId)
            .single();

        if (departmentCheckError || !department) {
            return res.status(403).json({ error: 'Unauthorized or department not found.' });
        }

        // Verify user ownership of the company
        const { data: company, error: companyError } = await supabase
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .eq('user_id', userId)
            .single();

        if (companyError || !company) {
            return res.status(403).json({ error: 'Unauthorized to delete department from this company.' });
        }
        
        const { error } = await supabase
            .from('departments')
            .delete()
            .eq('id', departmentId)
            .eq('company_id', companyId); // Ensure only department for this company is deleted

        if (error) {
            console.error('Delete department error:', error);
            throw new Error('Failed to delete department.');
        }

        res.status(204).send(); // No Content
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

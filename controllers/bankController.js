// backend/controllers/bankController.js
import supabase from '../libs/supabaseClient.js'
import path from'path';
import { fileURLToPath } from 'url';
import  fs from'fs';

// Path to the static banks JSON file
// Recreate __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const banksFilePath = path.join(__dirname, '../data/banks.json');

// Get all Kenyan bank data from the JSON file
export const getKenyanBanks = (req, res) => {
    try {
        const banksData = JSON.parse(fs.readFileSync(banksFilePath, 'utf8'));
        res.status(200).json(banksData);
    } catch (error) {
        console.error('Failed to read banks.json:', error);
        res.status(500).json({ error: 'Failed to retrieve bank data.' });
    }
};

// Get all bank details for a specific employee
export const getEmployeeBankDetails = async (req, res) => {
    const { companyId, employeeId } = req.params;
    const userId = req.userId;

    try {
        // Ownership check - simplified from previous controllers for brevity but still essential
        const { data: company, error: companyError } = await supabase
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .eq('user_id', userId)
            .single();

        if (companyError || !company) {
            return res.status(403).json({ error: 'Unauthorized to access this company\'s data.' });
        }

        const { data, error } = await supabase
            .from('employee_bank_details')
            .select('*')
            .eq('employee_id', employeeId);

        if (error) {
            console.error('Fetch employee bank details error:', error);
            throw new Error('Failed to fetch employee bank details.');
        }

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Add or update employee bank/M-Pesa details
export const updateEmployeeBankDetails = async (req, res) => {
    const { companyId, employeeId } = req.params;
    const userId = req.userId;
    const { bank_name, bank_code, branch_name, account_number, payment_method, phone_number } = req.body;

    if (!payment_method) {
        return res.status(400).json({ error: 'Payment method is required.' });
    }

    try {
        // Ownership check
        const { data: company, error: companyError } = await supabase
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .eq('user_id', userId)
            .single();

        if (companyError || !company) {
            return res.status(403).json({ error: 'Unauthorized to modify this company\'s data.' });
        }

        // Upsert operation to handle both adding and updating a single record
        const { data, error } = await supabase
            .from('employee_bank_details')
            .upsert({
                employee_id: employeeId,
                bank_name: payment_method === 'Bank' ? bank_name : null,
                bank_code: payment_method === 'Bank' ? bank_code : null,
                branch_name: payment_method === 'Bank' ? branch_name : null,
                account_number: payment_method === 'Bank' ? account_number : null,
                phone_number: payment_method === 'M-Pesa' ? phone_number : null,
                payment_method: payment_method,
            }, { onConflict: 'employee_id' }) // Conflict on employee_id ensures one record per employee
            .select()
            .single();

        if (error) {
            console.error('Update employee bank details error:', error);
            throw new Error('Failed to update employee bank details.');
        }

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Delete employee bank/M-Pesa details
export const deleteEmployeeBankDetails = async (req, res) => {
    const { companyId, employeeId } = req.params;
    const userId = req.userId;

    try {
        // Ownership check
        const { data: company, error: companyError } = await supabase
            .from('companies')
            .select('id')
            .eq('id', companyId)
            .eq('user_id', userId)
            .single();

        if (companyError || !company) {
            return res.status(403).json({ error: 'Unauthorized to delete this company\'s data.' });
        }

        const { error } = await supabase
            .from('employee_bank_details')
            .delete()
            .eq('employee_id', employeeId);
        
        if (error) {
            console.error('Delete employee bank details error:', error);
            throw new Error('Failed to delete employee bank details.');
        }

        res.status(204).send(); // No content
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

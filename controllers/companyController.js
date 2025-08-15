// backend/controllers/companyController.js
import supabase from '../libs/supabaseClient.js'
import { v4 as uuidv4 } from "uuid";

// Add a new company
export const addCompany = async (req, res) => {
    const { business_name, business_type, kra_pin, nssf_employer, shif_employer, helb_employer, housing_levy_employer, address, company_phone, company_email } = req.body;
    const logoFile = req.file;
    const userId = req.userId; // userId will be populated by our new auth middleware

    if (!business_name) {
        return res.status(400).json({ error: 'Business name is required.' });
    }

    try {
        let logoUrl = '';

        // 1. Upload logo to Supabase Storage if a file is provided
        if (logoFile) {
            const fileExt = logoFile.originalname.split('.').pop();
            const fileName = `${userId}/${uuidv4()}.${fileExt}`;
            const { error: uploadError } = await supabase.storage
                .from('company_logos')
                .upload(fileName, logoFile.buffer, { contentType: logoFile.mimetype });

            if (uploadError) {
                console.error('Logo upload error:', uploadError);
                throw new Error('Failed to upload logo.');
            }

            const { data: { publicUrl } } = supabase.storage
                .from('company_logos')
                .getPublicUrl(fileName);
            
            logoUrl = publicUrl;
        }

        // 2. Insert company data into the `companies` table
        const { data, error: insertError } = await supabase
            .from('companies')
            .insert({
                user_id: userId,
                business_name,
                business_type,
                kra_pin,
                nssf_employer,
                shif_employer,
                helb_employer,
                housing_levy_employer,
                address,
                company_phone,
                company_email,
                logo_url: logoUrl,
            })
            .select()
            .single();

        if (insertError) {
            console.error('Company insert error:', insertError);
            throw new Error('Failed to save company details.');
        }

        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get all companies for the current user
export const getCompanies = async (req, res) => {
    const userId = req.userId; // userId is from the auth middleware

    try {
        const { data, error } = await supabase
            .from('companies')
            .select('*') // Select all columns for now
            .eq('user_id', userId);

        if (error) {
            console.error('Fetch companies error:', error);
            throw new Error('Failed to fetch companies.');
        }

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

//module.exports = { addCompany, getCompanies };
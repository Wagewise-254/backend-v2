// backend/controllers/companyController.js
import supabase from '../libs/supabaseClient.js'
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from '../services/email.js';

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

// Update company
export const updateCompany = async (req, res) => {
  const companyId = req.params.id;
  const userId = req.userId;
  const updates = req.body;
  const logoFile = req.file;

  try {
    let logoUrl = updates.logo_url; // keep old logo unless replaced

    // Handle logo upload
    if (logoFile) {
      const fileExt = logoFile.originalname.split('.').pop();
      const fileName = `${userId}/${uuidv4()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('company_logos')
        .upload(fileName, logoFile.buffer, { contentType: logoFile.mimetype });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('company_logos')
        .getPublicUrl(fileName);

      logoUrl = publicUrl;
    }

    // Update company
    const { data, error } = await supabase
      .from('companies')
      .update({ ...updates, logo_url: logoUrl })
      .eq('id', companyId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json(data);
  } catch (err) {
    console.error('Update company error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const transferCompany = async (req, res) => {
  const  {companyId}  = req.params;
  const { recipientEmail } = req.body;
  const currentUserId = req.userId;

  try {
    // 1. Verify the current user owns the company
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('user_id, business_name')
      .eq('id', companyId)
      .single();

    if (companyError || !company) {
      return res.status(404).json({ error: 'Company not found.' });
    }
    if (company.user_id !== currentUserId) {
      return res.status(403).json({ error: 'You do not have permission to transfer this company.' });
    }

    // 2. Find the recipient's user ID
    const { data: recipientUser, error: recipientError } = await supabase.auth.admin.getUserByEmail(recipientEmail);

    if (recipientError || !recipientUser) {
      return res.status(404).json({ error: 'Recipient user not found.' });
    }
    if (recipientUser.user.id === currentUserId) {
      return res.status(400).json({ error: 'Cannot transfer company to yourself.' });
    }

    const newOwnerId = recipientUser.user.id;

    // 3. Update the company ownership
    const { error: transferError } = await supabase
      .from('companies')
      .update({ user_id: newOwnerId })
      .eq('id', companyId);

    if (transferError) {
      console.error("Company transfer error:", transferError);
      return res.status(500).json({ error: "Failed to transfer company ownership." });
    }

    // 4. Send email notifications
    //const currentOwnerEmail = recipientUser.user.email; // We get this from the user's session in a real app

    // This is a placeholder, you will need to find a way to get the current user's email
    // For simplicity, we assume we have it.
    const currentOwner = await supabase.auth.admin.getUserById(currentUserId);
    const currentOwnerEmailAddress = currentOwner.user.email;

    // Email to the new owner
    await sendEmail(
      recipientEmail,
      'Company Transfer Complete',
      `You have been made the new owner of the company "${company.business_name}".`
    );

    // Email to the previous owner
    await sendEmail(
      currentOwnerEmailAddress,
      'Company Transfer Complete',
      `You have successfully transferred ownership of "${company.business_name}" to ${recipientEmail}.`
    );

    res.status(200).json({ message: 'Company ownership transferred successfully.' });

  } catch (err) {
    console.error("Transfer company controller error:", err);
    res.status(500).json({ error: err.message });
  }
};



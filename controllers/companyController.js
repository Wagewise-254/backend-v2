// backend/controllers/companyController.js
import supabase from "../libs/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "../services/email.js";
import supabaseAdmin from "../libs/supabaseAdmin.js";

// Add a new company
export const addCompany = async (req, res) => {
  const {
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
  } = req.body;
  const logoFile = req.file;
  const userId = req.userId; // userId will be populated by our new auth middleware

  if (!business_name) {
    return res.status(400).json({ error: "Business name is required." });
  }

  try {
    let logoUrl = "";

    // 1. Upload logo to Supabase Storage if a file is provided
    if (logoFile) {
      const fileExt = logoFile.originalname.split(".").pop();
      const fileName = `${userId}/${uuidv4()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from("company_logos")
        .upload(fileName, logoFile.buffer, { contentType: logoFile.mimetype });

      if (uploadError) {
        console.error("Logo upload error:", uploadError);
        throw new Error("Failed to upload logo.");
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("company_logos").getPublicUrl(fileName);

      logoUrl = publicUrl;
    }

    // 2. Insert company data into the `companies` table
    const { data, error: insertError } = await supabase
      .from("companies")
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
      console.error("Company insert error:", insertError);
      throw new Error("Failed to save company details.");
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
      .from("companies")
      .select("*") // Select all columns for now
      .eq("user_id", userId);

    if (error) {
      console.error("Fetch companies error:", error);
      throw new Error("Failed to fetch companies.");
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
      const fileExt = logoFile.originalname.split(".").pop();
      const fileName = `${userId}/${uuidv4()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from("company_logos")
        .upload(fileName, logoFile.buffer, { contentType: logoFile.mimetype });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("company_logos").getPublicUrl(fileName);

      logoUrl = publicUrl;
    }

    // Update company
    const { data, error } = await supabase
      .from("companies")
      .update({ ...updates, logo_url: logoUrl })
      .eq("id", companyId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json(data);
  } catch (err) {
    console.error("Update company error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const transferCompany = async (req, res) => {
  const { companyId } = req.params;
  const { recipientEmail } = req.body;
  const currentUserId = req.userId;

  try {
    // 1. Verify the current user owns the company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, user_id, business_name")
      .eq("id", companyId)
      .single();

    if (companyError || !company) {
      return res.status(404).json({ error: "Company not found." });
    }
    if (company.user_id !== currentUserId) {
      return res
        .status(403)
        .json({
          error: "You do not have permission to transfer this company.",
        });
    }

    // 2. Fetch recipient user using listUsers
    const { data: usersData, error: usersError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (usersError) {
      return res.status(500).json({ error: "Failed to fetch users list." });
    }
    const recipientUser = usersData?.users?.find(
      (u) => u.email === recipientEmail
    );

    if (!recipientUser) {
      return res.status(404).json({ error: "Recipient user not found." });
    }

    if (recipientUser.id === currentUserId) {
      return res
        .status(400)
        .json({ error: "Cannot transfer company to yourself." });
    }


    const newOwnerId = recipientUser.id;

    // 3. Update the company ownership
    const { error: transferError } = await supabase
      .from("companies")
      .update({ user_id: newOwnerId })
      .eq("id", companyId);

    if (transferError) {
      console.error("Company transfer error:", transferError);
      return res
        .status(500)
        .json({ error: "Failed to transfer company ownership." });
    }

    // 4. Get current owner's email
    const { data: currentOwnerData, error: ownerError } =
      await supabaseAdmin.auth.admin.getUserById(currentUserId);

    const currentOwner = currentOwnerData?.user;

    if (ownerError || !currentOwner) {
      console.warn("Could not fetch current owner email.");
    }

    // 5. Send notifications
    await sendEmail({
      to: recipientEmail,
      subject: "Company Transfer Complete",
      text: `You are now the new owner of "${company.business_name}".`,
      html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; padding: 20px;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                            <td align="center" style="padding-bottom: 20px;">
                                <h1 style="color: #7F5EFD; font-size: 28px; margin: 0;">Wagewise</h1>
                            </td>
                        </tr>
                        <tr>
                            <td align="center">
                                <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.05);">
                                    <tr>
                                        <td style="padding: 40px;">
                                            <p style="font-size: 18px; margin-bottom: 20px;">Dear ${
                                              recipientUser.user_metadata
                                                .user_name || "User"
                                            },</p>
                                            <p style="font-size: 16px; margin-bottom: 20px;">You have been made the new owner of <b>${company.business_name}</b>.</p>
                                            <p style="font-size: 16px; margin-top: 20px;">Best regards,<br>The Team</p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <td align="center" style="padding-top: 20px;">
                                <p style="font-size: 12px; color: #888;">&copy; ${new Date().getFullYear()} Wagewise. All rights reserved.</p>
                            </td>
                        </tr>
                    </table>
                </div>
      <p></p>`,
    });

    if (currentOwner?.email) {
      await sendEmail({
        to: currentOwner.email,
        subject: "Company Transfer Complete",
        text: `You have successfully transferred ownership of "${company.business_name}" to ${recipientEmail}.`,
        html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; padding: 20px;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                            <td align="center" style="padding-bottom: 20px;">
                                <h1 style="color: #7F5EFD; font-size: 28px; margin: 0;">Wagewise</h1>
                            </td>
                        </tr>
                        <tr>
                            <td align="center">
                                <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.05);">
                                    <tr>
                                        <td style="padding: 40px;">
                                            <p style="font-size: 18px; margin-bottom: 20px;">Dear ${
                                              currentOwner.user_metadata
                                                .user_name || "User"
                                            },</p>
                                            <p style="font-size: 16px; margin-bottom: 20px;">You successfully transferred ownership of <b>${
                                              company.business_name
                                            }</b> to ${recipientEmail}.</p>
                                            <p style="font-size: 16px; margin-top: 20px;">Best regards,<br>The Team</p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <tr>
                            <td align="center" style="padding-top: 20px;">
                                <p style="font-size: 12px; color: #888;">&copy; ${new Date().getFullYear()} Wagewise. All rights reserved.</p>
                            </td>
                        </tr>
                    </table>
                </div>
        `,
      });
    }

    res
      .status(200)
      .json({ message: "Company ownership transferred successfully." });
  } catch (err) {
    console.error("Transfer company controller error:", err);
    res.status(500).json({ error: err.message });
  }
};

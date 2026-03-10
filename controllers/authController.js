import supabase from "../libs/supabaseAdmin.js";
import { sendEmailService } from "../services/brevo.js";
import crypto from 'crypto';

// Generate a random 6-digit code
const generateRecoveryCode = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// Store recovery codes in a separate table (you'll need to create this)
const storeRecoveryCode = async (email, code) => {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 10); // Code expires in 10 minutes

  const { error } = await supabase
    .from('password_recovery_codes')
    .insert([
      {
        email,
        code,
        expires_at: expiresAt.toISOString(),
        used: false
      }
    ]);

  if (error) throw error;
};

// Verify recovery code
const verifyRecoveryCode = async (email, code) => {
  const { data, error } = await supabase
    .from('password_recovery_codes')
    .select('*')
    .eq('email', email)
    .eq('code', code)
    .eq('used', false)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  
  if (!data || data.length === 0) {
    return null;
  }

  // Mark code as used
  await supabase
    .from('password_recovery_codes')
    .update({ used: true })
    .eq('id', data[0].id);

  return data[0];
};

// Mask email for display
const maskEmail = (email) => {
  const [localPart, domain] = email.split('@');
  const maskedLocal = localPart.charAt(0) + '*'.repeat(localPart.length - 2) + localPart.charAt(localPart.length - 1);
  return `${maskedLocal}@${domain}`;
};

// Send recovery code
export const sendRecoveryCode = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Check if user exists in Supabase Auth
    const { data: userData, error: userError } = await supabase.auth.admin.listUsers();
    
    if (userError) throw userError;

    const user = userData.users.find(u => u.email === email);

    // Always return the same message for security (don't reveal if email exists)
    const maskedEmail = maskEmail(email);

    if (!user) {
      // Return masked email even for non-existent users to prevent email enumeration
      return res.status(200).json({ 
        message: 'If an account exists, a recovery code will be sent',
        maskedEmail 
      });
    }

    // Generate and store recovery code
    const recoveryCode = generateRecoveryCode();
    await storeRecoveryCode(email, recoveryCode);

    // Send email via Brevo
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #1F3A8A; margin: 0;">Password Recovery</h1>
        </div>
        
        <p style="font-size: 16px; color: #333;">Hello,</p>
        
        <p style="font-size: 16px; color: #333;">We received a request to reset your password. Use the following 6-digit code to verify your identity:</p>
        
        <div style="background-color: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 5px;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1F3A8A;">${recoveryCode}</span>
        </div>
        
        <p style="font-size: 14px; color: #666;">This code will expire in <strong>10 minutes</strong>.</p>
        
        <p style="font-size: 14px; color: #666;">If you didn't request this password reset, please ignore this email or contact support if you have concerns.</p>
        
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
        
        <p style="font-size: 12px; color: #999; text-align: center;">
          &copy; ${new Date().getFullYear()} WageWise. All rights reserved.<br />
          This is an automated message, please do not reply to this email.
        </p>
      </div>
    `;

    await sendEmailService({
      to: email,
      subject: 'Password Recovery Code - WageWise',
      html: emailHtml,
      text: `Your password recovery code is: ${recoveryCode}. This code will expire in 10 minutes.`,
      company: 'WageWise'
    });

    res.status(200).json({ 
      message: 'Recovery code sent successfully',
      maskedEmail,
      emailForVerification: email // Send full email for verification step
    });

  } catch (error) {
    console.error('Send recovery code error:', error);
    res.status(500).json({ error: 'Failed to send recovery code. Please try again.' });
  }
};

// Verify recovery code
export const verifyRecoveryCodeSent = async (req, res) => {
  const { recoveryEmail, code } = req.body;

  if (!recoveryEmail || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }

  try {
    const validCode = await verifyRecoveryCode(recoveryEmail, code);

    if (!validCode) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    // Get user ID from auth.users
    const { data: userData, error: userError } = await supabase.auth.admin.listUsers();
    
    if (userError) throw userError;

    const user = userData.users.find(u => u.email === recoveryEmail);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({ 
      message: 'Code verified successfully',
      userId: user.id 
    });

  } catch (error) {
    console.error('Verify code error:', error);
    res.status(500).json({ error: 'Failed to verify code. Please try again.' });
  }
};

// Reset password using Admin SDK
export const resetPassword = async (req, res) => {
  const { userId, newPassword } = req.body;

  if (!userId || !newPassword) {
    return res.status(400).json({ error: 'User ID and new password are required' });
  }

  // Password validation
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }

  try {
    // Use Supabase Admin SDK to update user password
    const { data, error } = await supabase.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (error) throw error;

    // Log the password reset event (optional)
    console.log(`Password reset successful for user: ${userId}`);

    res.status(200).json({ 
      message: 'Password reset successfully' 
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password. Please try again.' });
  }
};
import { Resend } from 'resend';
import dotenv from "dotenv";

dotenv.config();

// Initialize Resend with your API Key
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * sendEmailService - Resend implementation with same signature as Brevo
 * @param {Object} options - to, subject, text, html, company, attachments
 */
export const sendEmailService = async ({
  to,
  subject,
  text,
  html,
  company,
  attachments = [],
}) => {
  try {
    // Format sender name with company
    const fromName = company || "WageDesk";
    
    // For Resend free tier, you can only send from onboarding@resend.dev
    // or from a verified domain if you have one
    const fromEmail = process.env.RESEND_DOMAIN 
      ? `${fromName} <noreply@${process.env.RESEND_DOMAIN}>`
      : `${fromName} <onboarding@resend.dev>`;

    console.log(`📧 Resend: Sending email to:`, Array.isArray(to) ? to : [to]);
    console.log(`📧 Resend: From: ${fromEmail}`);

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: Array.isArray(to) ? to : [to],
      subject: subject,
      html: html,
      text: text,
      attachments: attachments.map(file => ({
        filename: file.name,
        content: file.content instanceof Buffer 
          ? file.content.toString('base64')
          : file.content,
      })),
    });

    if (error) {
      console.error("❌ Resend API Error:", error);
      throw new Error(error.message);
    }

    console.log("✅ Resend success:", data?.id);
    
    // Return in same format as Brevo for compatibility
    return {
      id: data?.id,
      messageId: data?.id,
      provider: 'resend',
    };
    
  } catch (err) {
    console.error("❌ Resend Dispatch Error:", err.message);
    throw new Error(`Failed to send email: ${err.message}`);
  }
};

/**
 * Test function to verify Resend is working
 */
export const testResendConnection = async () => {
  try {
    // Just check if API key is valid by listing domains or sending a test
    const { data, error } = await resend.emails.send({
      from: "WageDesk <onboarding@resend.dev>",
      to: ["delivered@resend.dev"], // Resend's test inbox
      subject: "Test Connection",
      html: "<p>Testing Resend connection</p>",
    });
    
    return { success: !error, data, error };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
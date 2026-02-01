// backend/email.js
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Sends an email using the configured Nodemailer transporter.
 * @param {object} options - An object containing recipient, subject, and email body (text or HTML).
 * @param {string} options.to - The recipient's email address.
 * @param {string} options.subject - The subject line of the email.
 * @param {string} [options.text] - The plain text body of the email.
 * @param {string} [options.html] - The HTML body of the email.
 * @param {Array} [options.attachments] - Optional array of attachments to include in the email.
 */

export const sendEmail = async (options) => {
  if (!process.env.RESEND_API_KEY) {
    console.error("Missing RESEND_API_KEY");
    throw new Error("Email service configuration missing.");
  }

  try {
    const response = await resend.emails.send({
      from: process.env.EMAIL_FROM || "WageWise <onboarding@resend.dev>",
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments?.map((att) => ({
        filename: att.filename,
        content: att.content, // Buffer is OK
      })),
    });

    console.log(`Email sent to ${options.to}:`, response.id);
    return response;
  } catch (error) {
    console.error(`Error sending email to ${options.to}:`, error.message);
    throw new Error(`Failed to send email. Reason: ${error.message}`);
  }
};

/**
 * Generates a modern HTML email template for the payslip notification.
 * @param {string} employeeName - The full name of the employee.
 * @param {string} companyName - The name of the company.
 * @param {string} payrollPeriod - The payroll period (e.g., "May 2024").
 * @returns {string} The HTML content of the email.
 */
export const getPayslipEmailTemplate = (employeeName, companyName, payrollPeriod) => {
    const currentYear = new Date().getFullYear();
    const dashboardUrl = process.env.FRONTEND_DASHBOARD_URL || '#'; // Fallback to '#' if not set

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
        body { margin: 0; padding: 0; width: 100% !important; background-color: #f4f5f7; font-family: 'Inter', Arial, sans-serif; }
        .container { width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        .header { background-color: #7F5EFD; color: #ffffff; padding: 24px; text-align: center; border-top-left-radius: 8px; border-top-right-radius: 8px; }
        .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
        .content { padding: 32px; color: #333333; }
        .content p { font-size: 16px; line-height: 1.7; margin: 0 0 16px; }
        .content .highlight { font-weight: 600; color: #7F5EFD; }
        .button-container { text-align: center; margin-top: 32px; }
        .button { background-color: #7F5EFD; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600; display: inline-block; }
        .footer { padding: 24px; text-align: center; font-size: 12px; color: #888888; }
      </style>
    </head>
    <body>
      <table width="100%" border="0" cellspacing="0" cellpadding="20" style="background-color: #f4f5f7;">
        <tr>
          <td align="center">
            <div class="container">
              <div class="header">
                <h1>Wagewise</h1>
              </div>
              <div class="content">
                <p>Hello ${employeeName},</p>
                <p>Your payslip from <span class="highlight">${companyName}</span> for the period <span class="highlight">${payrollPeriod}</span> is ready and attached to this email.</p>
                <P>Best regards,</P>
                <p>The Wagewise Team</p>
              </div>
              <div class="footer">
                <p>&copy; ${currentYear} Wagewise. All rights reserved.</p>
              </div>
            </div>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};

export const getP9AEmailTemplate = (employeeName, companyName, year) => {
    return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <p>Hello ${employeeName},</p>
        <p>Attached is your P9A tax deduction card for the year ${year} from ${companyName}.</p>
        <p>This document summarizes your annual earnings and tax deductions as required by the Kenya Revenue Authority (KRA).</p>
        <p>If you have any questions, please contact your payroll administrator.</p>
        <p>Best regards,<br/>The ${companyName} Payroll Team</p>
    </div>
    `;
};

/**
 * Generates a modern HTML email template for the password recovery code.
 * @param {string} recoveryCode - The 6-digit recovery code.
 * @returns {string} The HTML content of the email.
 */
export const getRecoveryCodeEmailTemplate = (recoveryCode) => {
    const currentYear = new Date().getFullYear();

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
        body { margin: 0; padding: 0; width: 100% !important; background-color: #f4f5f7; font-family: 'Inter', Arial, sans-serif; }
        .container { width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        .header { background-color: #7F5EFD; color: #ffffff; padding: 24px; text-align: center; border-top-left-radius: 8px; border-top-right-radius: 8px; }
        .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
        .content { padding: 32px; color: #333333; }
        .content p { font-size: 16px; line-height: 1.7; margin: 0 0 16px; }
        .code-box { background-color: #f0ebff; border: 1px dashed #c4b5fd; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0; }
        .code { font-size: 36px; font-weight: 700; color: #6d28d9; letter-spacing: 8px; }
        .footer { padding: 24px; text-align: center; font-size: 12px; color: #888888; }
        .footer p { margin: 0 0 4px; }
      </style>
    </head>
    <body>
      <table width="100%" border="0" cellspacing="0" cellpadding="20" style="background-color: #f4f5f7;">
        <tr>
          <td align="center">
            <div class="container">
              <div class="header">
                <h1>Wagewise Account Recovery</h1>
              </div>
              <div class="content">
                <p>Hello,</p>
                <p>We received a request to reset your password. Use the code below to complete the process. This code will expire in 10 minutes.</p>
                <div class="code-box">
                  <p class="code">${recoveryCode}</p>
                </div>
                <p>If you did not request a password reset, you can safely ignore this email. Only a person with access to your email can reset your account password.</p>
              </div>
              <div class="footer">
                <p>&copy; ${currentYear} Wagewise. All rights reserved.</p>
                <p>Wagewise, Kenya</p>
              </div>
            </div>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};


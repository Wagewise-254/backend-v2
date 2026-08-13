// backend/services/resend.js

import { Resend } from 'resend';
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);
const DOMAIN = process.env.RESEND_DOMAIN;

export const sendEmailService = async ({
  to,
  subject,
  text,
  html,
  company,
  attachments = [],
}) => {
  try {
    const from = DOMAIN
      ? `${company || "WageWise"} <noreply@${DOMAIN}>`
      : `WageWise <onboarding@resend.dev>`;

    console.log(`📧 Resend: Sending email to:`, Array.isArray(to) ? to : [to]);
    console.log(`📧 Resend: From: ${from}`);

    const formattedTo = Array.isArray(to) ? to : [to];

    const formattedAttachments = attachments.map((file) => ({
      filename: file.filename || file.name || "attachment.pdf",
      content:
        file.content instanceof Buffer
          ? file.content.toString("base64")
          : file.content,
      contentType: file.contentType || 'application/pdf',
    }));

    const { data, error } = await resend.emails.send({
      from,
      to: formattedTo,
      subject,
      html,
      text,
      attachments: formattedAttachments.length > 0 ? formattedAttachments : undefined,
    });

    if (error) {
      console.error("❌ Resend API Error:", error);
      throw new Error(error.message);
    }

    console.log("✅ Email sent:", data?.id);
    
    return {
      id: data?.id,
      provider: 'resend',
    };
    
  } catch (err) {
    console.error("❌ Resend Dispatch Error:", err.message);
    throw new Error(`Failed to send email: ${err.message}`);
  }
};

export const getPayslipEmailTemplate = (employeeName, companyName, payrollPeriod) => {
  const currentYear = new Date().getFullYear();

  return `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <p>Hello ${employeeName},</p>

      <p>Your payslip for the period <strong>${payrollPeriod}</strong> from <strong>${companyName}</strong> is attached to this email.</p>

      <p>If you have any questions regarding your salary or deductions, please contact your payroll administrator.</p>

      <p>Best regards,<br/>${companyName} Payroll Team</p>

      <hr style="margin-top:24px;border:none;border-top:1px solid #eee;"/>
      <p style="font-size:11px;color:#999;text-align:center;">Powered by WageWise · ${currentYear}</p>
  </div>
  `;
};

export const getP9AEmailTemplate = (employeeName, companyName, year) => {
  const currentYear = new Date().getFullYear();

  return `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <p>Hello ${employeeName},</p>

      <p>Attached is your P9A tax deduction card for the year <strong>${year}</strong> from <strong>${companyName}</strong>.</p>

      <p>This document summarizes your annual earnings and tax deductions as required by the Kenya Revenue Authority (KRA).</p>

      <p>If you have any questions, please contact your payroll administrator.</p>

      <p>Best regards,<br/>${companyName} Payroll Team</p>

      <hr style="margin-top:24px;border:none;border-top:1px solid #eee;"/>
      <p style="font-size:11px;color:#999;text-align:center;">Powered by WageDesk · ${currentYear}</p>
  </div>
  `;
};
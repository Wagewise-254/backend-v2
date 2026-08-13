// backend/controllers/payslipHubController.js

import supabase from '../libs/supabaseClient.js';
import { format } from 'date-fns';
import { generatePayslipPDF, generateMultiplePayslipsPDF } from '../utils/payslipGenerator.js';
import { sendEmailService, getPayslipEmailTemplate } from '../services/resendService.js';

/**
 * Generate and download a single payslip
 */
export const generatePayslipPdf = async (req, res) => {
  const { companyId, payrollDetailId } = req.params;
  const { preview, layout = 'single' } = req.query;

  if (!payrollDetailId || !companyId) {
    return res.status(400).json({ error: 'Payroll detail ID and Company ID are required.' });
  }

  try {
    const payrollData = await fetchPayslipData(payrollDetailId, companyId);
    
    if (!payrollData) {
      return res.status(404).json({ error: 'Payslip data not found.' });
    }

    const { employee, payroll_run, ...details } = payrollData;
    const { company } = payroll_run;
    const formattedPeriod = `${payroll_run.payroll_month} ${payroll_run.payroll_year}`;

    // Generate PDF based on layout
    let pdfBuffer;
    if (layout === 'duplicate' || layout === 'two-up') {
      // For duplicate or two-up, we need to handle differently
      pdfBuffer = await generateMultiplePayslipsPDF(
        [{ detail, employee, company, formattedPeriod }],
        layout === 'duplicate' ? 'duplicate' : 'two-up'
      );
    } else {
      pdfBuffer = await generatePayslipPDF(details, formattedPeriod, company, employee);
    }

    // Update downloaded status if not preview
    if (preview !== 'true') {
      await supabase
        .from('payroll_details')
        .update({ 
          payslip_downloaded_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', payrollDetailId);
    }

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    
    if (preview === 'true') {
      res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
    } else {
      const fileName = `Payslip_${employee.first_name}_${employee.last_name}_${payroll_run.payroll_month}_${payroll_run.payroll_year}.pdf`;
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    }

    res.send(pdfBuffer);

  } catch (err) {
    console.error('Error generating payslip:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Email a single payslip
 */
export const emailPayslip = async (req, res) => {
  const { companyId, payrollDetailId } = req.params;

  if (!payrollDetailId || !companyId) {
    return res.status(400).json({ error: 'Payroll detail ID and Company ID are required.' });
  }

  try {
    const payrollData = await fetchPayslipData(payrollDetailId, companyId);
    
    if (!payrollData) {
      return res.status(404).json({ error: 'Payslip data not found.' });
    }

    if (!payrollData.employee.email) {
      return res.status(400).json({ error: 'Employee email address not found.' });
    }

    const { employee, payroll_run, ...details } = payrollData;
    const { company } = payroll_run;
    const formattedPeriod = `${payroll_run.payroll_month} ${payroll_run.payroll_year}`;

    // Generate PDF
    const pdfBuffer = await generatePayslipPDF(details, formattedPeriod, company, employee);
    const fileName = `Payslip_${employee.first_name}_${employee.last_name}_${payroll_run.payroll_month}_${payroll_run.payroll_year}.pdf`;

    // Send email
    const employeeFullName = `${employee.first_name || ''} ${employee.middle_name || ''} ${employee.last_name || ''}`.trim();
    const htmlContent = getPayslipEmailTemplate(employeeFullName, company.business_name, formattedPeriod);

    await sendEmailService({
      to: employee.email,
      subject: `Your Payslip for ${formattedPeriod} from ${company.business_name}`,
      html: htmlContent,
      company: company.business_name,
      attachments: [{
        filename: fileName,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });

    // Update sent status
    await supabase
      .from('payroll_details')
      .update({ 
        payslip_sent_at: new Date().toISOString(),
        payslip_sent_method: 'EMAIL',
        updated_at: new Date().toISOString()
      })
      .eq('id', payrollDetailId);

    // Log the activity
    await logPayslipActivity(payrollDetailId, 'EMAIL_SENT', {
      employeeId: employee.id,
      email: employee.email,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({ 
      message: 'Payslip emailed successfully.',
      data: { 
        employeeId: employee.id,
        email: employee.email,
        sentAt: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('Error emailing payslip:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Bulk email multiple payslips
 */
export const emailPayslipsBulk = async (req, res) => {
  const { companyId } = req.params;
  const { employeeIds, layout = 'single' } = req.body;
  console.log('Bulk email request received for employee IDs:', employeeIds);

  if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
    return res.status(400).json({ error: 'Employee IDs array is required.' });
  }

  try {
    // Fetch all payroll details
    const { data: payrollDetails, error } = await supabase
      .from('payroll_details')
      .select(`
        *,
        employee:employee_id (
          id,
          employee_number,
          first_name,
          middle_name,
          last_name,
          email,
          krapin,
          nssf_number,
          shif_number,
          employee_type
        ),
        payroll_run:payroll_run_id (
          payroll_month,
          payroll_year,
          company:company_id (
            id,
            business_name,
            location,
            company_phone,
            company_email,
            logo_url,
            smtp_host,
            smtp_port,
            smtp_username,
            smtp_password,
            smtp_from_email,
            smtp_from_name,
            smtp_encryption,
            use_company_smtp
          )
        )
      `)
      .in('id', employeeIds)
      .eq('is_eligible', true);

      //console.log(payrollDetails, 'payrollDetails')

    if (error || !payrollDetails || payrollDetails.length === 0) {
      console.error('Supabase fetch error:', error);
      return res.status(404).json({ error: 'No payslips found for the specified employees.' });
    }

    // Security check
    const invalidDetails = payrollDetails.filter(pd => pd.payroll_run.company.id !== companyId);
    if (invalidDetails.length > 0) {
      return res.status(403).json({ error: 'Some payslips do not belong to this company.' });
    }

    const results = [];
    const failedResults = [];

    // Process each payslip
    for (const payrollData of payrollDetails) {
      const { employee, payroll_run, ...details } = payrollData;
      const { company } = payroll_run;
      const formattedPeriod = `${payroll_run.payroll_month} ${payroll_run.payroll_year}`;

      try {
        if (!employee.email) {
          failedResults.push({
            employeeId: employee.id,
            employeeName: `${employee.first_name} ${employee.last_name}`,
            error: 'No email address found'
          });
          continue;
        }

        // Generate PDF
        const pdfBuffer = await generatePayslipPDF(details, formattedPeriod, company, employee);
        const fileName = `Payslip_${employee.first_name}_${employee.last_name}_${payroll_run.payroll_month}_${payroll_run.payroll_year}.pdf`;

        // Send email
        const employeeFullName = `${employee.first_name || ''} ${employee.middle_name || ''} ${employee.last_name || ''}`.trim();
        const htmlContent = getPayslipEmailTemplate(employeeFullName, company.business_name, formattedPeriod);

        await sendEmailService({
          to: employee.email,
          subject: `Your Payslip for ${formattedPeriod} from ${company.business_name}`,
          html: htmlContent,
          company: company.business_name,
          attachments: [{
            filename: fileName,
            content: pdfBuffer,
            contentType: 'application/pdf',
          }],
        });

        // Update sent status
        await supabase
          .from('payroll_details')
          .update({ 
            payslip_sent_at: new Date().toISOString(),
            payslip_sent_method: 'EMAIL',
            updated_at: new Date().toISOString()
          })
          .eq('id', payrollData.id);

        results.push({
          employeeId: employee.id,
          employeeName: `${employee.first_name} ${employee.last_name}`,
          email: employee.email,
          status: 'success',
          sentAt: new Date().toISOString()
        });

        // Log activity
        await logPayslipActivity(payrollData.id, 'EMAIL_SENT', {
          employeeId: employee.id,
          email: employee.email,
          timestamp: new Date().toISOString()
        });

      } catch (err) {
        console.error(`Failed to send payslip to ${employee.email}:`, err);
        failedResults.push({
          employeeId: employee.id,
          employeeName: `${employee.first_name} ${employee.last_name}`,
          email: employee.email,
          error: err.message || 'Failed to send email'
        });
      }
    }

    // Prepare response
    const response = {
      message: 'Bulk email processing completed.',
      total: payrollDetails.length,
      successCount: results.length,
      failedCount: failedResults.length,
      results,
      failed: failedResults
    };

    // If all failed, return error status
    if (results.length === 0) {
      return res.status(500).json({
        ...response,
        error: 'All emails failed to send'
      });
    }

    res.status(200).json(response);

  } catch (err) {
    console.error('Error in bulk email:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Generate bulk payslips for download
 */
export const generatePayslipsBulk = async (req, res) => {
  const { companyId } = req.params;
  const { employeeIds, layout = 'single', duplicate = false } = req.body;

  if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
    return res.status(400).json({ error: 'Employee IDs array is required.' });
  }

  try {
    // Fetch all payroll details
    const { data: payrollDetails, error } = await supabase
      .from('payroll_details')
      .select(`
        *,
        employee:employee_id (
          id,
          employee_number,
          first_name,
          middle_name,
          last_name,
          email,
          krapin,
          nssf_number,
          shif_number,
          employee_type
        ),
        payroll_run:payroll_run_id (
          payroll_month,
          payroll_year,
          company:company_id (
            id,
            business_name,
            location,
            company_phone,
            company_email,
            logo_url
          )
        )
      `)
      .in('id', employeeIds)
      .eq('is_eligible', true);

    if (error || !payrollDetails || payrollDetails.length === 0) {
      console.error('Supabase fetch error:', error);
      return res.status(404).json({ error: 'No payslips found for the specified employees.' });
    }

    // Security check
    const invalidDetails = payrollDetails.filter(pd => pd.payroll_run.company.id !== companyId);
    if (invalidDetails.length > 0) {
      return res.status(403).json({ error: 'Some payslips do not belong to this company.' });
    }

    // Prepare data for PDF generation
    const payslipData = payrollDetails.map(pd => ({
      detail: pd,
      employee: pd.employee,
      company: pd.payroll_run.company,
      formattedPeriod: `${pd.payroll_run.payroll_month} ${pd.payroll_run.payroll_year}`
    }));

    // Generate PDF with specified layout
    const pdfBuffer = await generateMultiplePayslipsPDF(payslipData, layout, duplicate);

    // Update downloaded status for all
    const now = new Date().toISOString();
    await supabase
      .from('payroll_details')
      .update({ 
        payslip_downloaded_at: now,
        updated_at: now
      })
      .in('id', employeeIds);

    // Log activity
    for (const pd of payrollDetails) {
      await logPayslipActivity(pd.id, 'DOWNLOADED', {
        employeeId: pd.employee.id,
        timestamp: now
      });
    }

    // Return PDF
    const fileName = `Payslips_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('Error generating bulk payslips:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Preview payslips (returns HTML or JSON for frontend preview)
 */
export const previewPayslips = async (req, res) => {
  const { companyId } = req.params;
  const { employeeIds, layout = 'single', duplicate = false } = req.body;

  if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
    return res.status(400).json({ error: 'Employee IDs array is required.' });
  }

  try {
    // Fetch payroll details
    const { data: payrollDetails, error } = await supabase
      .from('payroll_details')
      .select(`
        *,
        employee:employee_id (
          id,
          employee_number,
          first_name,
          middle_name,
          last_name,
          email,
          krapin,
          nssf_number,
          shif_number,
          employee_type
        ),
        payroll_run:payroll_run_id (
          payroll_month,
          payroll_year,
          company:company_id (
            id,
            business_name,
            location,
            company_phone,
            company_email,
            logo_url
          )
        )
      `)
      .in('id', employeeIds)
      .eq('is_eligible', true);

    if (error || !payrollDetails || payrollDetails.length === 0) {
      return res.status(404).json({ error: 'No payslips found.' });
    }

    // Format data for frontend preview
    const previewData = payrollDetails.map(pd => ({
      id: pd.id,
      employee_id: pd.employee_id,
      employee_name: `${pd.employee.first_name} ${pd.employee.last_name}`,
      employee_number: pd.employee.employee_number,
      email: pd.employee.email,
      job_title: pd.job_title,
      department_name: pd.department_name,
      net_pay: pd.net_pay,
      payslip_generated_at: pd.payslip_generated_at,
      payslip_sent_at: pd.payslip_sent_at,
      payslip_viewed_at: pd.payslip_viewed_at,
      review_status: pd.review_status || 'PENDING',
      // Include all necessary data for rendering
      payroll_month: pd.payroll_run.payroll_month,
      payroll_year: pd.payroll_run.payroll_year,
      company_name: pd.payroll_run.company.business_name,
      logo_url: pd.payroll_run.company.logo_url,
      // Payroll details
      basic_salary: pd.basic_salary,
      gross_pay: pd.gross_pay,
      total_deductions: pd.total_deductions,
      paye_tax: pd.paye_tax,
      nssf_deduction: pd.nssf_deduction,
      shif_deduction: pd.shif_deduction,
      housing_levy_deduction: pd.housing_levy_deduction,
      helb_deduction: pd.helb_deduction,
      allowances_details: pd.allowances_details,
      deductions_details: pd.deductions_details,
      payment_method: pd.payment_method,
      bank_name: pd.bank_name,
      account_name: pd.account_name
    }));

    res.status(200).json({
      data: previewData,
      layout,
      duplicate,
      total: previewData.length
    });

  } catch (err) {
    console.error('Error previewing payslips:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Mark a single payslip as sent
 */
export const markPayslipSent = async (req, res) => {
  const { companyId, payrollDetailId } = req.params;

  try {
    const { data, error } = await supabase
      .from('payroll_details')
      .update({ 
        payslip_sent_at: new Date().toISOString(),
        payslip_sent_method: 'NONE',
        updated_at: new Date().toISOString()
      })
      .eq('id', payrollDetailId)
      .eq('payroll_run.company_id', companyId)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Payslip not found or update failed.' });
    }

    await logPayslipActivity(payrollDetailId, 'MARKED_SENT', {
      method: 'MANUAL',
      timestamp: new Date().toISOString()
    });

    res.status(200).json({ 
      message: 'Payslip marked as sent.',
      data: { sent_at: data.payslip_sent_at }
    });

  } catch (err) {
    console.error('Error marking payslip as sent:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Mark multiple payslips as sent
 */
export const markPayslipsBulkSent = async (req, res) => {
  const { companyId } = req.params;
  const { payrollDetailsIds, payrollRunId } = req.body;

  console.log('Marking payslips as sent for company:', companyId);
  console.log('PayrollDetail IDs:', payrollDetailsIds);
  console.log('Payroll Run ID:', payrollRunId);

   if (!payrollDetailsIds || !Array.isArray(payrollDetailsIds) || payrollDetailsIds.length === 0) {
    return res.status(400).json({ error: 'Payroll Detail IDs array is required.' });
  }

  if (!payrollRunId) {
    return res.status(400).json({ error: 'Payroll Run ID is required.' });
  }

  try {
    const now = new Date().toISOString();
    
     // First, get the payroll_details that match both employee IDs and payroll run ID
    const { data: detailsToUpdate, error: fetchError } = await supabase
      .from('payroll_details')
      .select('id, employee_id')
      .eq('payroll_run_id', payrollRunId)
      .in('id', payrollDetailsIds);

    if (fetchError) {
      console.error('Error fetching payroll details:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch payslips.' });
    }

    console.log('Found payroll details:', detailsToUpdate);

    if (!detailsToUpdate || detailsToUpdate.length === 0) {
      return res.status(404).json({ 
        error: 'No payslips found for the specified employees in this payroll run.' 
      });
    }

    const detailIds = detailsToUpdate.map(d => d.id);
    console.log('Updating detail IDs:', detailIds);

    // Now update the found records
    const { data, error } = await supabase
      .from('payroll_details')
      .update({ 
        payslip_sent_at: now,
        payslip_sent_method: 'NONE',
        updated_at: now
      })
      .in('id', detailIds)
      .select();

    if (error) {
      console.error('Error updating payslips:', error);
      return res.status(500).json({ error: 'Failed to update payslips.' });
    }

    // Log activities
    for (const pd of data || []) {
      await logPayslipActivity(pd.id, 'MARKED_SENT', {
        method: 'MANUAL_BULK',
        timestamp: now
      });
    }

    res.status(200).json({
      message: `${data?.length || 0} payslips marked as sent.`,
      data: { 
        updated: data?.length || 0,
        sent_at: now
      }
    });

  } catch (err) {
    console.error('Error marking payslips as sent:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
/**
 * Mark payslip as viewed
 */
export const markPayslipViewed = async (req, res) => {
  const { companyId, payrollDetailId } = req.params;

  try {
    const { data, error } = await supabase
      .from('payroll_details')
      .update({ 
        payslip_viewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', payrollDetailId)
      .eq('payroll_run.company_id', companyId)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Payslip not found or update failed.' });
    }

    await logPayslipActivity(payrollDetailId, 'VIEWED', {
      timestamp: new Date().toISOString()
    });

    res.status(200).json({ 
      message: 'Payslip marked as viewed.',
      data: { viewed_at: data.payslip_viewed_at }
    });

  } catch (err) {
    console.error('Error marking payslip as viewed:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Mark payslip as downloaded
 */
export const markPayslipDownloaded = async (req, res) => {
  const { companyId, payrollDetailId } = req.params;

  try {
    const { data, error } = await supabase
      .from('payroll_details')
      .update({ 
        payslip_downloaded_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', payrollDetailId)
      .eq('payroll_run.company_id', companyId)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Payslip not found or update failed.' });
    }

    await logPayslipActivity(payrollDetailId, 'DOWNLOADED', {
      timestamp: new Date().toISOString()
    });

    res.status(200).json({ 
      message: 'Payslip marked as downloaded.',
      data: { downloaded_at: data.payslip_downloaded_at }
    });

  } catch (err) {
    console.error('Error marking payslip as downloaded:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Update payslip status (sent/unset)
 */
export const updatePayslipStatus = async (req, res) => {
  const { companyId, payrollDetailId } = req.params;
  const { status } = req.body; // 'sent' or 'unsent'

  if (!status || !['sent', 'unsent'].includes(status)) {
    return res.status(400).json({ error: 'Status must be "sent" or "unsent".' });
  }

  try {
    const updates = {
      updated_at: new Date().toISOString()
    };

    if (status === 'sent') {
      updates.payslip_sent_at = new Date().toISOString();
      updates.payslip_sent_method = 'MANUAL';
    } else {
      updates.payslip_sent_at = null;
      updates.payslip_sent_method = null;
    }

    const { data, error } = await supabase
      .from('payroll_details')
      .update(updates)
      .eq('id', payrollDetailId)
      .eq('payroll_run.company_id', companyId)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Payslip not found or update failed.' });
    }

    await logPayslipActivity(payrollDetailId, `STATUS_${status.toUpperCase()}`, {
      status,
      timestamp: new Date().toISOString()
    });

    res.status(200).json({ 
      message: `Payslip status updated to ${status}.`,
      data: { 
        sent_at: data.payslip_sent_at,
        status: data.payslip_sent_at ? 'sent' : 'unsent'
      }
    });

  } catch (err) {
    console.error('Error updating payslip status:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Get payslip status
 */
export const getPayslipStatus = async (req, res) => {
  const { companyId, payrollDetailId } = req.params;

  try {
    const { data, error } = await supabase
      .from('payroll_details')
      .select(`
        id,
        payslip_generated_at,
        payslip_sent_at,
        payslip_sent_method,
        payslip_viewed_at,
        payslip_downloaded_at,
        employee:employee_id (
          id,
          first_name,
          last_name,
          email
        )
      `)
      .eq('id', payrollDetailId)
      .eq('payroll_run.company_id', companyId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Payslip not found.' });
    }

    const status = {
      generated: !!data.payslip_generated_at,
      sent: !!data.payslip_sent_at,
      sent_method: data.payslip_sent_method,
      viewed: !!data.payslip_viewed_at,
      downloaded: !!data.payslip_downloaded_at,
      generated_at: data.payslip_generated_at,
      sent_at: data.payslip_sent_at,
      viewed_at: data.payslip_viewed_at,
      downloaded_at: data.payslip_downloaded_at,
      employee: {
        id: data.employee.id,
        name: `${data.employee.first_name} ${data.employee.last_name}`,
        email: data.employee.email
      }
    };

    res.status(200).json({ status });

  } catch (err) {
    console.error('Error getting payslip status:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Get payslip delivery logs
 */
export const getPayslipDeliveryLogs = async (req, res) => {
  const { companyId } = req.params;
  const { payrollRunId, employeeId } = req.query;

  try {
    let query = supabase
      .from('payroll_details')
      .select(`
        id,
        payslip_sent_at,
        payslip_sent_method,
        payslip_viewed_at,
        payslip_downloaded_at,
        employee:employee_id (
          id,
          first_name,
          last_name,
          email,
          employee_number
        )
      `)
      .eq('payroll_run.company_id', companyId)
      .not('payslip_sent_at', 'is', null)
      .order('payslip_sent_at', { ascending: false });

    if (payrollRunId) {
      query = query.eq('payroll_run_id', payrollRunId);
    }

    if (employeeId) {
      query = query.eq('employee_id', employeeId);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch delivery logs.' });
    }

    const logs = data.map(item => ({
      payslipId: item.id,
      employeeId: item.employee.id,
      employeeName: `${item.employee.first_name} ${item.employee.last_name}`,
      employeeNumber: item.employee.employee_number,
      email: item.employee.email,
      sentAt: item.payslip_sent_at,
      sentMethod: item.payslip_sent_method,
      viewedAt: item.payslip_viewed_at,
      downloadedAt: item.payslip_downloaded_at,
      status: 'delivered'
    }));

    res.status(200).json({ logs, total: logs.length });

  } catch (err) {
    console.error('Error getting delivery logs:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// Helper functions
const fetchPayslipData = async (payrollDetailId, companyId) => {
  const { data, error } = await supabase
    .from('payroll_details')
    .select(`
      *,
      employee:employee_id (
        id,
        employee_number,
        first_name,
        middle_name,
        last_name,
        email,
        krapin,
        nssf_number,
        shif_number,
        employee_type
      ),
      payroll_run:payroll_run_id (
        payroll_month,
        payroll_year,
        company:company_id (
          id,
          business_name,
          location,
          company_phone,
          company_email,
          logo_url
        )
      )
    `)
    .eq('id', payrollDetailId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  // Security check
  if (data.payroll_run.company.id !== companyId) {
    return null;
  }

  return data;
};

const logPayslipActivity = async (payrollDetailId, action, metadata) => {
  try {
    await supabase
      .from('audit_logs')
      .insert({
        entity_type: 'PAYSLIP',
        entity_id: payrollDetailId,
        action: action,
        new_data: metadata,
        created_at: new Date().toISOString()
      });
  } catch (err) {
    console.error('Error logging payslip activity:', err);
    // Don't throw, just log the error
  }
};
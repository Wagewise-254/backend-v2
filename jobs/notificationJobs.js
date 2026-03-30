// backend/jobs/notificationJobs.js
import supabase from '../libs/supabaseAdmin.js';
import notificationService from '../services/notificationService.js';

// Run daily at 8 AM
export const checkPayrollNotifications = async () => {
  console.log('Running payroll notification checks...');
  const now = new Date();
  const currentMonth = now.toLocaleString('default', { month: 'long' });
  const currentYear = now.getFullYear();

  try {
    // Get all companies
    const { data: companies } = await supabase
      .from('companies')
      .select('id, business_name')
      .eq('status', 'APPROVED');

    for (const company of companies || []) {
      // Get company admins and managers
      const { data: companyUsers } = await supabase
        .from('company_users')
        .select('user_id')
        .eq('company_id', company.id)
        .in('role', ['ADMIN', 'MANAGER']);

      if (!companyUsers?.length) continue;

      const userIds = companyUsers.map(u => u.user_id);

      // Check if payroll exists for current month
      const { data: payrollRun } = await supabase
        .from('payroll_runs')
        .select('id, status, created_at')
        .eq('company_id', company.id)
        .eq('payroll_month', currentMonth)
        .eq('payroll_year', currentYear)
        .maybeSingle();

      // Payroll Not Run
      if (!payrollRun) {
        const notifications = userIds.map(userId => ({
          company_id: company.id,
          user_id: userId,
          type: 'PAYROLL_REMINDER',
          title: 'Payroll Not Started',
          message: `Payroll for ${currentMonth} ${currentYear} has not been started.`,
          severity: 'WARNING',
          entity_type: 'company',
          entity_id: company.id
        }));
        await notificationService.createBulkNotifications(notifications);
      } 
      // Payroll Still in Draft (older than 3 days)
      else if (payrollRun.status === 'DRAFT') {
        const daysInDraft = Math.floor((now - new Date(payrollRun.created_at)) / (1000 * 60 * 60 * 24));
        if (daysInDraft > 3) {
          const notifications = userIds.map(userId => ({
            company_id: company.id,
            user_id: userId,
            type: 'PAYROLL_REMINDER',
            title: 'Payroll Still in Draft',
            message: `Payroll for ${currentMonth} ${currentYear} has been in draft for ${daysInDraft} days.`,
            severity: 'WARNING',
            entity_type: 'payroll_run',
            entity_id: payrollRun.id
          }));
          await notificationService.createBulkNotifications(notifications);
        }
      }
      // Payroll Awaiting Approval
      else if (payrollRun.status === 'UNDER_REVIEW') {
        const notifications = userIds.map(userId => ({
          company_id: company.id,
          user_id: userId,
          type: 'PAYROLL_APPROVAL',
          title: 'Payroll Awaiting Approval',
          message: `Payroll for ${currentMonth} ${currentYear} is waiting for reviewer approval.`,
          severity: 'INFO',
          entity_type: 'payroll_run',
          entity_id: payrollRun.id
        }));
        await notificationService.createBulkNotifications(notifications);
      }
      // Payroll Locked but Not Paid
      else if (payrollRun.status === 'LOCKED') {
        const notifications = userIds.map(userId => ({
          company_id: company.id,
          user_id: userId,
          type: 'PAYROLL_PAYMENT',
          title: 'Payroll Locked but Not Paid',
          message: `Payroll for ${currentMonth} ${currentYear} has been locked but not paid.`,
          severity: 'WARNING',
          entity_type: 'payroll_run',
          entity_id: payrollRun.id
        }));
        await notificationService.createBulkNotifications(notifications);
      }
    }
  } catch (error) {
    console.error('Error in payroll notification check:', error);
  }
};

// Check contract expirations (run daily)
export const checkContractExpirations = async () => {
  console.log('Checking contract expirations...');
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  try {
    const { data: expiringContracts } = await supabase
      .from('employee_contracts')
      .select(`
        id,
        end_date,
        employee:employee_id (
          id,
          first_name,
          last_name,
          company_id
        )
      `)
      .lte('end_date', thirtyDaysFromNow.toISOString().split('T')[0])
      .gte('end_date', new Date().toISOString().split('T')[0]);

    for (const contract of expiringContracts || []) {
      // Get company admins
      const { data: admins } = await supabase
        .from('company_users')
        .select('user_id')
        .eq('company_id', contract.employee.company_id)
        .in('role', ['ADMIN', 'MANAGER']);

      if (!admins?.length) continue;

      const daysUntilExpiry = Math.floor(
        (new Date(contract.end_date) - new Date()) / (1000 * 60 * 60 * 24)
      );

      const notifications = admins.map(admin => ({
        company_id: contract.employee.company_id,
        user_id: admin.user_id,
        type: 'CONTRACT_ALERT',
        title: 'Contract Expiring Soon',
        message: `Contract for ${contract.employee.first_name} ${contract.employee.last_name} expires in ${daysUntilExpiry} days.`,
        severity: 'WARNING',
        entity_type: 'employee',
        entity_id: contract.employee.id,
        metadata: { contract_id: contract.id, days_remaining: daysUntilExpiry }
      }));

      await notificationService.createBulkNotifications(notifications);
    }
  } catch (error) {
    console.error('Error checking contract expirations:', error);
  }
};

// Check missing employee details (run daily)
export const checkMissingEmployeeDetails = async () => {
  console.log('Checking missing employee details...');

  try {
    // Find employees missing bank details (ONLY those without ANY payment details)
    const { data: employeesMissingBank } = await supabase
      .from('employees')
      .select(`
        id,
        first_name,
        last_name,
        company_id,
        employee_payment_details!left (
          id,
          account_number
        )
      `)
      .eq('employee_status', 'ACTIVE') // Only active employees
      .or('employee_payment_details.id.is.null,employee_payment_details.account_number.is.null');

    for (const employee of employeesMissingBank || []) {
      // Check if notification already exists for this specific employee
      const { data: existingNotification } = await supabase
        .from('notifications')
        .select('id')
        .eq('company_id', employee.company_id)
        .eq('type', 'EMPLOYEE_UPDATE')
        .eq('entity_id', employee.id)
        .eq('entity_type', 'employee')
        .eq('is_read', false)
        .eq('is_archived', false)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1);

      // Skip if notification already exists
      if (existingNotification && existingNotification.length > 0) {
        console.log(`Skipping duplicate notification for employee ${employee.id} (missing bank details)`);
        continue;
      }

      // Get company admins
      const { data: admins } = await supabase
        .from('company_users')
        .select('user_id')
        .eq('company_id', employee.company_id)
        .in('role', ['ADMIN', 'MANAGER']);

      if (!admins?.length) continue;

      const notifications = admins.map(admin => ({
        company_id: employee.company_id,
        user_id: admin.user_id,
        type: 'EMPLOYEE_UPDATE',
        title: 'Missing Bank Details',
        message: `${employee.first_name} ${employee.last_name} has no bank account details.`,
        severity: 'WARNING',
        entity_type: 'employee',
        entity_id: employee.id,
        metadata: { missing_field: 'bank_details' }
      }));

      await notificationService.createBulkNotifications(notifications);
    }

    // Find employees missing KRA PIN (ONLY those without KRA PIN)
    const { data: employeesMissingKRA } = await supabase
      .from('employees')
      .select('id, first_name, last_name, company_id, krapin')
      .eq('employee_status', 'ACTIVE') // Only active employees
      .is('krapin', null);

    for (const employee of employeesMissingKRA || []) {
      // Check if notification already exists for this specific employee
      const { data: existingNotification } = await supabase
        .from('notifications')
        .select('id')
        .eq('company_id', employee.company_id)
        .eq('type', 'EMPLOYEE_UPDATE')
        .eq('entity_id', employee.id)
        .eq('entity_type', 'employee')
        .eq('is_read', false)
        .eq('is_archived', false)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1);

      // Skip if notification already exists
      if (existingNotification && existingNotification.length > 0) {
        console.log(`Skipping duplicate notification for employee ${employee.id} (missing KRA PIN)`);
        continue;
      }

      const { data: admins } = await supabase
        .from('company_users')
        .select('user_id')
        .eq('company_id', employee.company_id)
        .in('role', ['ADMIN', 'MANAGER']);

      if (!admins?.length) continue;

      const notifications = admins.map(admin => ({
        company_id: employee.company_id,
        user_id: admin.user_id,
        type: 'EMPLOYEE_UPDATE',
        title: 'Missing KRA PIN',
        message: `${employee.first_name} ${employee.last_name} has no KRA PIN.`,
        severity: 'WARNING',
        entity_type: 'employee',
        entity_id: employee.id,
        metadata: { missing_field: 'kra_pin' }
      }));

      await notificationService.createBulkNotifications(notifications);
    }
  } catch (error) {
    console.error('Error checking missing employee details:', error);
  }
};

// Clean up old notifications (run daily)
export const cleanupOldNotifications = async () => {
  console.log('Cleaning up old notifications...');
  
  try {
    // Archive notifications older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { error } = await supabase
      .from('notifications')
      .update({ is_archived: true })
      .lt('created_at', thirtyDaysAgo.toISOString())
      .eq('is_archived', false);

    if (error) throw error;
    console.log('Successfully cleaned up old notifications');
  } catch (error) {
    console.error('Error cleaning up notifications:', error);
  }
};
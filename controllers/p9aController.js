// backend/controllers/p9aController.js
import supabase from '../libs/supabaseClient.js';
import { generateP9APDF } from '../utils/p9aGenerator.js';

export const generateP9APdf = async (req, res) => {
  const { companyId, employeeId, year } = req.params;

  if (!companyId || !employeeId || !year) {
    return res.status(400).json({ error: 'Company ID, Employee ID, and Year are required.' });
  }

  try {
    // Fetch all payroll details for the given employee and year
    const { data: payrollData, error } = await supabase
      .from('payroll_details')
      .select(`
        *,
        employee:employee_id (
          id,
          first_name,
          last_name,
          other_names,
          krapin,
          employee_number
        ),
        payroll_run:payroll_run_id (
          payroll_month,
          payroll_year,
          company:company_id (
            id,
            business_name,
            kra_pin
          )
        )
      `)
      .eq('employee_id', employeeId)
      .eq('payroll_run.payroll_year', year); // Filter by the year from the payroll_run table

    if (error || !payrollData || payrollData.length === 0) {
      console.error('Supabase fetch error:', error);
      return res.status(404).json({ error: 'P9A data not found for the specified employee and year.' });
    }

    // Security: ensure the first record belongs to the correct company
    const firstRecord = payrollData[0];
    if (firstRecord.payroll_run.company.id !== companyId) {
      return res.status(403).json({ error: 'This P9A report does not belong to this company.' });
    }

    // Generate PDF buffer using the utility generator
    const pdfBuffer = await generateP9APDF(payrollData, firstRecord.employee, firstRecord.payroll_run.company, year);

    // Filename: P9A_First_Last_Year.pdf
    const fileName = `P9A_${firstRecord.employee.first_name}_${firstRecord.employee.last_name}_${year}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating P9A PDF:', error);
    res.status(500).json({ error: 'Failed to generate P9A PDF.' });
  }
};

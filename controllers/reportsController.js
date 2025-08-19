// backend/controllers/reportsController.js
import supabase from '../libs/supabaseClient.js';
import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

// Helper function to fetch payroll details for a given run
const fetchPayrollData = async (companyId, runId) => {
    const { data, error } = await supabase
        .from('payroll_details')
        .select(`
            *,
            employee:employee_id (
                first_name,
                last_name,
                other_names,
                phone,
                employee_number,
                krapin,
                nssf_number,
                shif_number,
                id_number,
                citizenship,
                employee_type
            ),
            payroll_run:payroll_run_id (
                payroll_number
            )
        `)
        .eq('payroll_run_id', runId);

    if (error) {
        throw new Error('Failed to fetch payroll data.');
    }

    // Security check: ensure the payroll run belongs to the company
    const { data: runData, error: runError } = await supabase
        .from('payroll_runs')
        .select('company_id')
        .eq('id', runId)
        .single();
    if (runError || runData.company_id !== companyId) {
        throw new Error('Unauthorized access to payroll run.');
    }

    return data;
};

// ... (Add all the helper functions for each file type here)

export const generateReport = async (req, res) => {
    const { companyId, runId, reportType } = req.params;

    if (!companyId || !runId || !reportType) {
        return res.status(400).json({ error: 'Missing required parameters.' });
    }

    try {
        const payrollData = await fetchPayrollData(companyId, runId);

        switch (reportType) {
            case 'kra-sec-b1':
                // Call KRA file generation logic
                const kraCsv = generateKraSecB1(payrollData);
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="KRA_SEC_B1_${runId}.csv"`);
                res.send(kraCsv);
                break;
            case 'nssf-return':
                // Call NSSF file generation logic
                const nssfExcelBuffer = await generateNssfReturn(payrollData);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="NSSF_Return_${runId}.xlsx"`);
                res.send(nssfExcelBuffer);
                break;
            case 'shif-return':
                const shifExcelBuffer = await generateShifReturn(payrollData);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="SHIF_Return_${runId}.xlsx"`);
                res.send(shifExcelBuffer);
                break;
            case 'housing-levy-return':
                const housingLevyCsv = generateHousingLevyReturn(payrollData);
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="Housing_Levy_${runId}.csv"`);
                res.send(housingLevyCsv);
                break;
            case 'helb-report':
                const helbExcelBuffer = await generateHelbReport(payrollData);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="HELB_Report_${runId}.xlsx"`);
                res.send(helbExcelBuffer);
                break;
            case 'bank-payment':
                const bankCsv = generateBankPaymentFile(payrollData);
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="Bank_Payments_${runId}.csv"`);
                res.send(bankCsv);
                break;
            case 'mpesa-payment':
                const mpesaCsv = generateMpesaPaymentFile(payrollData);
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="M-Pesa_Payments_${runId}.csv"`);
                res.send(mpesaCsv);
                break;
            case 'cash-payment':
                const cashPdfBuffer = await generateCashPaymentSheet(payrollData);
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="Cash_Sheet_${runId}.pdf"`);
                res.send(cashPdfBuffer);
                break;
            case 'payroll-summary':
                const summaryExcelBuffer = await generateGenericExcelReport(payrollData, 'Payroll Summary');
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="Payroll_Summary_${runId}.xlsx"`);
                res.send(summaryExcelBuffer);
                break;
            case 'allowance-report':
                const allowanceExcelBuffer = await generateGenericExcelReport(payrollData, 'Allowance Report');
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="Allowance_Report_${runId}.xlsx"`);
                res.send(allowanceExcelBuffer);
                break;
            case 'deduction-report':
                const deductionExcelBuffer = await generateGenericExcelReport(payrollData, 'Deduction Report');
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="Deduction_Report_${runId}.xlsx"`);
                res.send(deductionExcelBuffer);
                break;
            default:
                return res.status(404).json({ error: 'Report type not found.' });
        }
    } catch (err) {
        console.error('Error generating report:', err);
        res.status(500).json({ error: err.message || 'Internal server error.' });
    }
};

const formatCurrency = (amount) => {
  const num = parseFloat(amount);
  return isNaN(num) ? '0.00' : num.toFixed(2);
};

// Function to generate KRA SEC_B1 PAYE file (CSV)
const generateKraSecB1 = (data) => {
    // Define the fields for the CSV file. This acts as the header.
    const fields = [
        'KRA PIN',
        'Employee Name',
        'Resident Status',
        'Employee Type',
        'Basic Salary',
        'Housing Allowance',
        'Transport Allowance',
        'Leave Pay',
        'Overtime Allowance',
        'Director Fee',
        'Lump Sum',
        'Other Allowances',
        'Blank1',
        'Car Benefit',
        'Total Non-Cash Benefits',
        'Blank2',
        'Meals Benefit',
        'Type of Housing',
        'Blank3',
        'Blank4',
        'Blank5',
        'Blank6',
        'Blank7',
        'SHIF Deduction',
        'NSSF Deduction',
        'Blank8',
        'Blank9',
        'Housing Levy',
        'Blank10',
        'Blank11',
        'Blank12',
        'Monthly Personal Relief',
        'Blank13',
        'Blank14',
        'PAYE Tax'
    ];
    const kraRecords = data.map(record => {
        const allowancesString = record.allowances_details;
        let allowances = [];
        if (typeof allowancesString === 'string' && allowancesString.trim() !== '') {
            try {
                allowances = JSON.parse(allowancesString);
            } catch (e) {
                console.error("Failed to parse allowances_details for record:", record.id, e);
            }
        }
        
        const getAllowanceValue = (name) => {
            const allowance = allowances.find(a => a.name.toLowerCase().includes(name.toLowerCase()));
            return allowance ? parseFloat(allowance.value) : 0;
        };
        

        const otherAllowances = allowances
            .filter(a => !['housing', 'transport', 'leave pay', 'overtime', 'director fee', 'car benefit', 'meals benefit'].some(n => a.name.toLowerCase().includes(n)))
            .reduce((sum, a) => sum + parseFloat(a.value), 0);

        let resident_status = (record.employee.citizenship.toLowerCase() !== 'kenyan') ? 'Non-Resident' : 'Resident';
        let employee_type = (record.employee.employee_type.toLowerCase() !== 'primary') ? 'Secondary Employee' : 'Primary Employee';

        return {
            'KRA PIN': record.employee.krapin,
            'Employee Name': `${record.employee.first_name} ${record.employee.other_names || ''} ${record.employee.last_name}`.trim(),
            'Resident Status': resident_status,
            'Employee Type': employee_type,
            'Basic Salary': formatCurrency(record.basic_salary),
            'Housing Allowance': formatCurrency(getAllowanceValue('housing')),
            'Transport Allowance': formatCurrency(getAllowanceValue('transport')),
            'Leave Pay': formatCurrency(getAllowanceValue('leave pay')),
            'Overtime Allowance': formatCurrency(getAllowanceValue('overtime')),
            'Director Fee': formatCurrency(getAllowanceValue('director fee')),
            'Lump Sum': '0.00',
            'Other Allowances': formatCurrency(otherAllowances),
            'Blank1': '', // Blank
            'Car Benefit': formatCurrency(getAllowanceValue('car benefit')),
            'Total Non-Cash Benefits': formatCurrency(record.total_non_cash_benefits),
            'Blank2': '', // Blank
            'Meals Benefit': formatCurrency(getAllowanceValue('meals benefit')),
            'Type of Housing': 'Benefit not given',
            'Blank3': '', 'Blank4': '', 'Blank5': '', 'Blank6': '', 'Blank7': '',
            'SHIF Deduction': formatCurrency(record.shif_deduction),
            'NSSF Deduction': formatCurrency(record.nssf_deduction),
            'Blank8': '',
            'Blank9': '',
            'Housing Levy': formatCurrency(record.housing_levy_deduction),
            'Blank10': '', 'Blank11': '', 'Blank12': '',
            'Monthly Personal Relief': '2400.00',
            'Blank13': '', 'Blank14': '',
            'PAYE Tax': formatCurrency(record.paye_tax)
        };
    });

    const json2csvParser = new Parser({ fields });
    return json2csvParser.parse(kraRecords);
};

// Function to generate NSSF Return file (Excel)
const generateNssfReturn = async (data) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('NSSF Return');

    const headers = [
        'Payroll number', 'Surname', 'Other names', 'ID number',
        'KRA pin', 'NSSF Number', 'Gross Pay', 'Voluntary'
    ];
    worksheet.addRow(headers);

    data.forEach(record => {
        worksheet.addRow([
            record.payroll_run.payroll_number,
            record.employee.last_name,
            `${record.employee.first_name} ${record.employee.other_names || ''}`.trim(),
            record.employee.id_number,
            record.employee.krapin,
            record.employee.nssf_number,
            parseFloat(record.gross_pay),
            0 // Assuming voluntary is 0 for now
        ]);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
};

// ... (Add functions for other files)
const generateShifReturn = async (data) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('SHIF Return');
    const headers = [
        'Payroll number', 'First Name', 'Last Name', 'ID number',
        'KRA pin', 'SHIF number', 'Contribution Amount', 'Phone Number'
    ];
    worksheet.addRow(headers);
    data.forEach(record => {
        worksheet.addRow([
            record.payroll_run.payroll_number,
            record.employee.first_name,
            record.employee.last_name,
            record.employee.id_number,
            record.employee.krapin,
            record.employee.shif_number,
            parseFloat(record.shif_deduction),
            record.employee.phone // Assuming phone number is from employee record
        ]);
    });
    return await workbook.xlsx.writeBuffer();
};

const generateHousingLevyReturn = (data) => {
    const records = data.map(record => [
        record.employee.id_number,
        `${record.employee.first_name} ${record.employee.other_names || ''} ${record.employee.last_name}`.trim(),
        record.employee.krapin,
        formatCurrency(record.housing_levy_deduction)
    ].join(','));
    return records.join('\n');
};

const generateHelbReport = async (data) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('HELB Report');
    const headers = [
        'ID number', 'Full Name', 'Staff Number', 'Amount Deducted'
    ];
    worksheet.addRow(headers);
    data.forEach(record => {
        if (parseFloat(record.helb_deduction) > 0) {
            worksheet.addRow([
                record.employee.id_number,
                `${record.employee.first_name} ${record.employee.other_names || ''} ${record.employee.last_name}`.trim(),
                record.employee.employee_number,
                parseFloat(record.helb_deduction)
            ]);
        }
    });
    return await workbook.xlsx.writeBuffer();
};

const generateBankPaymentFile = (data) => {
    const records = data.filter(r => r.payment_method?.toLowerCase() === 'bank').map(record => [
        `${record.employee.first_name} ${record.employee.other_names || ''} ${record.employee.last_name}`.trim(),
        record.account_name,
        // Bank code and branch code not in payroll_details, assuming these are placeholders
        '',
        '',
        formatCurrency(record.net_pay),
        `Payroll Ref ${record.payroll_run.payroll_number}`
    ].join(','));
    return ['"full names","account number","bank code","branch code","amount","reference"', ...records].join('\n');
};

const generateMpesaPaymentFile = (data) => {
    const records = data.filter(r => r.payment_method?.toLowerCase() === 'mpesa').map(record => [
        `${record.employee.first_name} ${record.employee.other_names || ''} ${record.employee.last_name}`.trim(),
        record.mpesa_phone,
        formatCurrency(record.net_pay),
        `Payroll Ref ${record.payroll_run.payroll_number}`
    ].join(','));
    return ['"fullname","mpesa phone number","amount","reference"', ...records].join('\n');
};

const generateCashPaymentSheet = async (data) => {
    return new Promise(async (resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        doc.fontSize(12).text('Cash Payment Sheet', { align: 'center' });
        doc.moveDown();

        const tableTop = doc.y;
        const table = {
            headers: ['No.', 'Full Name', 'ID Number', 'Net Pay (KSh)', 'Signature'],
            rows: data.filter(r => r.payment_method?.toLowerCase() === 'cash').map((record, index) => [
                (index + 1).toString(),
                `${record.employee.first_name} ${record.employee.other_names || ''} ${record.employee.last_name}`.trim(),
                record.employee.id_number,
                formatCurrency(record.net_pay),
                '' // Blank for signature
            ])
        };

        const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const colWidth = tableWidth / table.headers.length;

        // Draw headers
        doc.font('Helvetica-Bold').fontSize(10);
        let currentX = doc.page.margins.left;
        table.headers.forEach(header => {
            doc.text(header, currentX, tableTop, { width: colWidth, align: 'center' });
            currentX += colWidth;
        });

        // Draw rows
        doc.font('Helvetica').fontSize(9);
        let currentY = tableTop + 20;
        table.rows.forEach(row => {
            currentX = doc.page.margins.left;
            row.forEach(cell => {
                doc.text(cell, currentX, currentY, { width: colWidth, align: 'center' });
                currentX += colWidth;
            });
            currentY += 20;
        });

        doc.end();
    });
};

// Generic report generation (Payroll Summary, Allowance, Deduction)
const generateGenericExcelReport = async (data, reportType) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(reportType);
    let headers;

    if (reportType === 'Payroll Summary') {
        headers = ['Employee No', 'Full Name', 'Basic Salary', 'Total Allowances', 'Total Deductions', 'Gross Pay', 'Net Pay'];
        worksheet.addRow(headers);
        data.forEach(record => {
            worksheet.addRow([
                record.employee.employee_number,
                `${record.employee.first_name} ${record.employee.last_name}`,
                parseFloat(record.basic_salary),
                parseFloat(record.total_allowances),
                parseFloat(record.total_deductions),
                parseFloat(record.gross_pay),
                parseFloat(record.net_pay)
            ]);
        });
    } else if (reportType === 'Allowance Report') {
        headers = ['Employee No', 'Full Name', 'Allowance Name', 'Amount'];
        worksheet.addRow(headers);
        data.forEach(record => {
            const allowances = JSON.parse(record.allowances_details || '[]');
            allowances.forEach(allowance => {
                worksheet.addRow([
                    record.employee.employee_number,
                    `${record.employee.first_name} ${record.employee.last_name}`,
                    allowance.name,
                    parseFloat(allowance.value)
                ]);
            });
        });
    } else if (reportType === 'Deduction Report') {
        headers = ['Employee No', 'Full Name', 'Deduction Name', 'Amount'];
        worksheet.addRow(headers);
        data.forEach(record => {
            const deductions = JSON.parse(record.deductions_details || '[]');
            deductions.forEach(deduction => {
                worksheet.addRow([
                    record.employee.employee_number,
                    `${record.employee.first_name} ${record.employee.last_name}`,
                    deduction.name,
                    parseFloat(deduction.value)
                ]);
            });
        });
    }

    return await workbook.xlsx.writeBuffer();
};
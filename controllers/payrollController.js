// backend/controllers/payrollController.js

import supabase from '../libs/supabaseClient.js';
import { getPayslipEmailTemplate} from '../services/email.js';
import { v4 as uuidv4 } from "uuid";

// --- Helper Functions for Kenyan Statutory Deductions ---

// As of 2024/2025 financial year
const calculatePAYE = (taxableIncome) => {
    let paye = 0;
    let personalRelief = 2400; // Monthly personal relief

    if (taxableIncome <= 24000) {
        paye = taxableIncome * 0.10;
    } else if (taxableIncome <= 32333) {
        paye = 2400 + (taxableIncome - 24000) * 0.25;
    } else if (taxableIncome <= 500000) {
        paye = 2400 + 2083.25 + (taxableIncome - 32333) * 0.30;
    } else if (taxableIncome <= 800000) {
        paye = 2400 + 2083.25 + 140300.1 + (taxableIncome - 500000) * 0.325;
    } else {
        paye = 2400 + 2083.25 + 140300.1 + 97500 + (taxableIncome - 800000) * 0.35;
    }

    // Apply personal relief
    let finalPaye = paye - personalRelief;
    return Math.max(0, finalPaye); // PAYE cannot be negative
};

// NSSF Tiered Contribution (New rates)
const calculateNSSF = (basicSalary) => {
    let tier1_cap = 7000;
    let tier2_cap = 36000;
    let totalNSSF = 0;
    const nssf_rate = 0.06;

    let tier1_deduction = Math.min(basicSalary, tier1_cap) * nssf_rate;
    totalNSSF += tier1_deduction;

    if (basicSalary > tier1_cap) {
        let tier2_deduction = Math.min(basicSalary - tier1_cap, tier2_cap - tier1_cap) * nssf_rate;
        totalNSSF += tier2_deduction;
    }
    
    // Note: The new NSSF Act (2013) contribution is tax-deductible for PAYE.
    // The calculation above is for the total contribution, half from employer and half from employee.
    // However, for payroll, we just need the employee's portion. The law is 6% of pensionable earnings for each.
    return totalNSSF;
};

// SHIF (NHIF) Contributions (New rates as of SHIF Act 2023)
const calculateSHIF = (grossSalary) => {
    return grossSalary * 0.0275; // Flat rate of 2.75% of gross pay
};

// Housing Levy
const calculateHousingLevy = (grossSalary) => {
    return grossSalary * 0.015; // 1.5% of gross pay
};

// --- Main Payroll Functions ---

export const calculatePayroll = async (req, res) => {
    const { companyId } = req.params;
    const { month, year } = req.body;
    const userId = req.userId;

    if (!month || !year) {
        return res.status(400).json({ error: 'Month and year are required.' });
    }

    try {
        // 1. Check if a payroll run for this month/year already exists
        const { data: existingRun, error: runError } = await supabase
            .from('payroll_runs')
            .select('id, status')
            .eq('company_id', companyId)
            .eq('payroll_month', month)
            .eq('payroll_year', year)
            .maybeSingle();

        if (runError && runError.code !== 'PGRST116') { // PGRST116 is for not-found
            throw new Error('Failed to check for existing payroll run.');
        }

        if (existingRun && existingRun.status === 'Completed') {
            return res.status(409).json({ error: 'Payroll for this period has already been completed.' });
        } else if (existingRun) {
            // Delete existing draft to create a new one.
            await supabase.from('payroll_runs').delete().eq('id', existingRun.id);
            await supabase.from('payroll_details').delete().eq('payroll_run_id', existingRun.id);
        }

        // 2. Fetch all active employees for the company
        const { data: employees, error: employeesError } = await supabase
            .from('employees')
            .select('*')
            .eq('company_id', companyId)
            .eq('employee_status', 'Active');
        
        if (employeesError) throw new Error('Failed to fetch employees.');
        if (employees.length === 0) {
            return res.status(404).json({ message: 'No active employees found.' });
        }

        // 3. Create a new payroll run entry
        const payrollRunId = uuidv4();
        const payrollNumber = `${companyId}-${year}-${month}`;

        await supabase.from('payroll_runs').insert({
            id: payrollRunId,
            company_id: companyId,
            payroll_number: payrollNumber,
            payroll_month: month,
            payroll_year: year,
            payroll_date: new Date().toISOString().split('T')[0],
            status: 'Draft'
        });

        const payrollDetailsToInsert = [];
        let totalGrossPay = 0;
        let totalStatutoryDeductions = 0;
        let totalPaye = 0;
        let totalNetPay = 0;

        // 4. Loop through each employee and calculate payroll
        for (const employee of employees) {
            let basicSalary = parseFloat(employee.salary);
            let totalAllowances = 0;
            let totalNonCashBenefits = 0;
            let totalDeductions = 0;
            let totalStatutoryDeductionsPerEmployee = 0;
            let totalCustomDeductions = 0;

            // Fetch allowances for the employee or their department
            const { data: allowances, error: allowancesError } = await supabase
                .from('allowances')
                .select(`*, allowance_type:allowance_type_id (is_cash, is_taxable)`)
                .or(`employee_id.eq.${employee.id},department_id.eq.${employee.department_id}`)
                .eq('is_active', true)
                .or(`end_date.is.null,end_date.gte.${new Date().toISOString().split('T')[0]}`)
                .eq('company_id', companyId);

            if (allowancesError) throw new Error('Failed to fetch allowances.');

            for (const allowance of allowances) {
                let allowanceValue = 0;
                if (allowance.calculation_type === 'Fixed') {
                    allowanceValue = parseFloat(allowance.value);
                } else if (allowance.calculation_type === 'Percentage') {
                    allowanceValue = basicSalary * (parseFloat(allowance.value) / 100);
                }

                if (allowance.allowance_type.is_cash) {
                    totalAllowances += allowanceValue;
                } else {
                    totalNonCashBenefits += allowanceValue;
                }
            }
            
            // Fetch custom deductions for the employee or their department
            const { data: deductions, error: deductionsError } = await supabase
                .from('deductions')
                .select(`*, deduction_type:deduction_type_id (is_tax_deductible)`)
                .or(`employee_id.eq.${employee.id},department_id.eq.${employee.department_id}`)
                .eq('is_active', true)
                .or(`end_date.is.null,end_date.gte.${new Date().toISOString().split('T')[0]}`)
                .eq('company_id', companyId);

            if (deductionsError) throw new Error('Failed to fetch deductions.');

            for (const deduction of deductions) {
                let deductionValue = 0;
                if (deduction.calculation_type === 'Fixed') {
                    deductionValue = parseFloat(deduction.value);
                } else if (deduction.calculation_type === 'Percentage') {
                    deductionValue = basicSalary * (parseFloat(deduction.value) / 100);
                }
                totalCustomDeductions += deductionValue;
            }
            
            // Calculate statutory deductions
            let grossPay = basicSalary + totalAllowances;
            let nssfDeduction = employee.pays_nssf ? calculateNSSF(basicSalary) : 0;
            let shifDeduction = employee.shif_number ? calculateSHIF(grossPay) : 0;
            let housingLevyDeduction = employee.pays_housing_levy ? calculateHousingLevy(grossPay) : 0;

            // Calculate taxable income
            let taxableIncome = grossPay - nssfDeduction;
            let helbDeduction = 0;

            // Handle HELB
            if (employee.pays_helb) {
                const { data: helbData, error: helbError } = await supabase
                    .from('helb_deductions')
                    .select('monthly_deduction')
                    .eq('employee_id', employee.id)
                    .single();
                
                if (helbError) throw new Error('Failed to fetch HELB details.');
                helbDeduction = parseFloat(helbData.monthly_deduction);
            }
            
            let payeTax = employee.pays_paye ? calculatePAYE(taxableIncome) : 0;
            
            totalStatutoryDeductionsPerEmployee = nssfDeduction + shifDeduction + housingLevyDeduction + helbDeduction + payeTax;
            totalDeductions = totalStatutoryDeductionsPerEmployee + totalCustomDeductions;
            
            let netPay = grossPay - totalDeductions + totalNonCashBenefits;

            // Add payroll details for this employee
            payrollDetailsToInsert.push({
                payroll_run_id: payrollRunId,
                employee_id: employee.id,
                basic_salary: basicSalary,
                total_allowances: totalAllowances,
                total_non_cash_benefits: totalNonCashBenefits,
                total_deductions: totalDeductions,
                total_statutory_deductions: totalStatutoryDeductionsPerEmployee,
                gross_pay: grossPay,
                taxable_income: taxableIncome,
                paye_tax: payeTax,
                nssf_deduction: nssfDeduction,
                shif_deduction: shifDeduction,
                helb_deduction: helbDeduction,
                housing_levy_deduction: housingLevyDeduction,
                net_pay: netPay,
            });

            totalGrossPay += grossPay;
            totalStatutoryDeductions += totalStatutoryDeductionsPerEmployee;
            totalPaye += payeTax;
            totalNetPay += netPay;
        }

        // 5. Insert all payroll details at once
        await supabase.from('payroll_details').insert(payrollDetailsToInsert);

        // 6. Update the payroll run with totals
        await supabase.from('payroll_runs').update({
            total_gross_pay: totalGrossPay,
            total_statutory_deductions: totalStatutoryDeductions,
            total_paye: totalPaye,
            total_net_pay: totalNetPay
        }).eq('id', payrollRunId);
        
        res.status(200).json({ message: 'Payroll calculated successfully and saved as a draft.' });

    } catch (error) {
        console.error('Payroll calculation error:', error);
        res.status(500).json({ error: 'Failed to calculate payroll.' });
    }
};

export const completePayrollRun = async (req, res) => {
    const { payrollRunId } = req.params;

    try {
        // 1. Get the draft payroll run details
        const { data: run, error: runError } = await supabase
            .from('payroll_runs')
            .select('id, company_id, payroll_month, payroll_year, status')
            .eq('id', payrollRunId)
            .maybeSingle();

        if (runError) throw new Error('Failed to fetch payroll run.');
        if (!run) return res.status(404).json({ error: 'Payroll run not found.' });
        if (run.status !== 'Draft') {
            return res.status(400).json({ error: 'Only draft payrolls can be completed.' });
        }
        
        // 2. Perform one-time updates
        const { data: details, error: detailsError } = await supabase
            .from('payroll_details')
            .select('employee_id, helb_deduction')
            .eq('payroll_run_id', payrollRunId);

        if (detailsError) throw new Error('Failed to fetch payroll details.');

        // Update HELB balances for each employee
        for (const detail of details) {
            if (detail.helb_deduction > 0) {
                await supabase.rpc('update_helb_balance', {
                    p_employee_id: detail.employee_id,
                    p_deduction_amount: detail.helb_deduction
                });
            }
        }
        
        // Deactivate one-time deductions after completion
        await supabase
            .from('deductions')
            .update({ is_active: false })
            .eq('is_one_time', true)
            .eq('company_id', run.company_id);

        // 3. Update payroll run status to 'Completed'
        const { data: completedRun, error: updateError } = await supabase
            .from('payroll_runs')
            .update({ status: 'Completed', updated_at: new Date().toISOString() })
            .eq('id', payrollRunId)
            .select()
            .single();

        if (updateError) throw new Error('Failed to complete payroll run.');

        res.status(200).json(completedRun);
    } catch (error) {
        console.error('Complete payroll error:', error);
        res.status(500).json({ error: error.message });
    }
};

export const getPayrollRuns = async (req, res) => {
    const { companyId } = req.params;

    try {
        const { data, error } = await supabase
            .from('payroll_runs')
            .select('*')
            .eq('company_id', companyId)
            .order('payroll_year', { ascending: false })
            .order('payroll_month', { ascending: false });

        if (error) throw new Error('Failed to fetch payroll runs.');

        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getPayrollDetails = async (req, res) => {
    const { runId } = req.params;

    try {
        const { data, error } = await supabase
            .from('payroll_details')
            .select(`
                *,
                employee:employee_id (
                    first_name, last_name, employee_number, email
                )
            `)
            .eq('payroll_run_id', runId);

        if (error) throw new Error('Failed to fetch payroll details.');

        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const cancelPayrollRun = async (req, res) => {
    const { payrollRunId } = req.params;

    try {
        const { data, error } = await supabase
            .from('payroll_runs')
            .update({ status: 'Cancelled' })
            .eq('id', payrollRunId)
            .eq('status', 'Draft') // Only allow canceling drafts
            .select();

        if (error) throw new Error('Failed to cancel payroll run.');
        
        if (data.length === 0) {
            return res.status(404).json({ error: 'Draft payroll run not found or already processed.' });
        }

        res.status(200).json({ message: 'Payroll run cancelled successfully.' });
    } catch (error) {
        console.error('Cancel payroll error:', error);
        res.status(500).json({ error: error.message });
    }
};


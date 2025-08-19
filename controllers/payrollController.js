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
    let tier1_cap = 8000;
    let tier2_cap = 72000;
    const nssf_rate = 0.06;
    let tier1_deduction = 0;
    let tier2_deduction = 0;

    tier1_deduction = Math.min(basicSalary, tier1_cap) * nssf_rate;
    
    if (basicSalary > tier1_cap) {
        tier2_deduction = Math.min(basicSalary - tier1_cap, tier2_cap - tier1_cap) * nssf_rate;
    }
    
    // The total contribution is tax-deductible for PAYE.
    // The law is 6% of pensionable earnings for each.
    return { tier1: tier1_deduction, tier2: tier2_deduction, total: tier1_deduction + tier2_deduction };
};

// SHIF (NHIF) Contributions (New rates as of SHIF Act 2023)
const calculateSHIF = (grossSalary) => {
   const shif = grossSalary * 0.0275; // Flat rate of 2.75% of gross pay
   return Math.round(shif);
};

// Housing Levy with rounding
const calculateHousingLevy = (grossSalary) => {
    const levy = grossSalary * 0.015;
    return Math.round(levy);
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
        
        // 2. Generate a unique payroll number for documents
        const { count, error: countError } = await supabase
            .from('payroll_runs')
            .select('*', { count: 'exact', head: true })
            .eq('company_id', companyId)
            .eq('payroll_month', month)
            .eq('payroll_year', year);

        if (countError) throw new Error('Failed to count previous payroll runs.');
        
        const payrollCount = count || 0;
        const payrollNumber = `PR-${year}-${String(month).padStart(2, '0')}-${String(payrollCount + 1).padStart(3, '0')}`;
        
        // 3. Fetch all active employees for the company
        const { data: employees, error: employeesError } = await supabase
            .from('employees')
            .select('*')
            .eq('company_id', companyId)
            .eq('employee_status', 'Active');
        
        if (employeesError) throw new Error('Failed to fetch employees.');
        if (employees.length === 0) {
            return res.status(404).json({ message: 'No active employees found.' });
        }
        
        // 4. Fetch all employee bank details
        const { data: bankDetails, error: bankDetailsError } = await supabase
            .from('employee_bank_details')
            .select('*')
            .in('employee_id', employees.map(emp => emp.id));
            
        if (bankDetailsError) throw new Error('Failed to fetch employee bank details.');
        const bankDetailsMap = new Map(bankDetails.map(item => [item.employee_id, item]));

        // 5. Create a new payroll run entry
        const payrollRunId = uuidv4();

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

        // 6. Loop through each employee and calculate payroll
        for (const employee of employees) {
            let basicSalary = parseFloat(employee.salary);
            let totalAllowances = 0;
            let totalNonCashBenefits = 0;
            let totalCustomDeductions = 0;
            let allowancesDetails = [];
            let deductionsDetails = [];

            // Fetch allowances for the employee or their department
            const { data: allowances, error: allowancesError } = await supabase
                .from('allowances')
                .select(`*, allowance_type:allowance_type_id (name, is_cash, is_taxable)`)
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
                
                allowancesDetails.push({
                    name: allowance.name,
                    value: allowanceValue,
                    is_cash: allowance.allowance_type.is_cash,
                    is_taxable: allowance.allowance_type.is_taxable
                });
            }
            
            // Fetch custom deductions for the employee or their department
            const { data: deductions, error: deductionsError } = await supabase
                .from('deductions')
                .select(`*, deduction_type:deduction_type_id (name, is_tax_deductible)`)
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
                
                deductionsDetails.push({
                    name: deduction.name,
                    value: deductionValue,
                    is_tax_deductible: deduction.deduction_type.is_tax_deductible
                });
            }
            
            // Calculate statutory deductions
            let grossPay = basicSalary + totalAllowances;
            let nssfTiers = employee.pays_nssf ? calculateNSSF(basicSalary) : { tier1: 0, tier2: 0, total: 0 };
            let nssfDeduction = nssfTiers.total;
            let shifDeduction = employee.shif_number ? calculateSHIF(grossPay) : 0;
            let housingLevyDeduction = employee.pays_housing_levy ? calculateHousingLevy(grossPay) : 0;

            // Calculate taxable income
            
            let helbDeduction = 0;

            // Handle HELB
            if (employee.pays_helb) {
                const { data: helbData, error: helbError } = await supabase
                    .from('helb_deductions')
                    .select('monthly_deduction')
                    .eq('employee_id', employee.id)
                    .maybeSingle();
                
                if (helbError) throw new Error('Failed to fetch HELB details.');
                helbDeduction = helbData ? parseFloat(helbData.monthly_deduction) : 0;
            }

            let taxableIncome = grossPay - nssfDeduction - shifDeduction - housingLevyDeduction - helbDeduction - totalCustomDeductions;
            
            let payeTax = employee.pays_paye ? calculatePAYE(taxableIncome) : 0;
            
            let totalStatutoryDeductionsPerEmployee = nssfDeduction + shifDeduction + housingLevyDeduction + helbDeduction + payeTax;
            let totalDeductions = totalStatutoryDeductionsPerEmployee + totalCustomDeductions;
            
            let netPay = grossPay + totalNonCashBenefits - totalDeductions;
            
            // Get employee payment details
            const employeeBankDetails = bankDetailsMap.get(employee.id);
            let paymentMethod = null;
            let bankName = null;
            let accountName = null;
            let mpesaPhone = null;

            if (employeeBankDetails) {
                paymentMethod = employeeBankDetails.payment_method;
                bankName = employeeBankDetails.bank_name || null;
                accountName = employeeBankDetails.account_number || null;
                mpesaPhone = employeeBankDetails.phone_number || null;
            }

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
                nssf_tier1_deduction: nssfTiers.tier1,
                nssf_tier2_deduction: nssfTiers.tier2,
                shif_deduction: shifDeduction,
                helb_deduction: helbDeduction,
                housing_levy_deduction: housingLevyDeduction,
                net_pay: netPay,
                payment_method: paymentMethod,
                bank_name: bankName,
                account_name: accountName,
                mpesa_phone: mpesaPhone,
                allowances_details: allowancesDetails,
                deductions_details: deductionsDetails
            });

            totalGrossPay += grossPay;
            totalStatutoryDeductions += totalStatutoryDeductionsPerEmployee;
            totalPaye += payeTax;
            totalNetPay += netPay;
        }

        // 7. Insert all payroll details at once
        await supabase.from('payroll_details').insert(payrollDetailsToInsert);

        // 8. Update the payroll run with totals
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
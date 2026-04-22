// backend/controllers/payrollController.js
import supabase from "../libs/supabaseClient.js";
import supabaseAdmin from "../libs/supabaseAdmin.js";
import { PAYROLL_STATUS } from "../constants/payrollStatus.js";
import { createAuditLog } from "../utils/auditLogger.js";
import { v4 as uuidv4 } from "uuid";

// --- Constants ---
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DISABILITY_EXEMPTION = 150000; // Annual tax exemption for PWDs
const INSURANCE_RELIEF_CAP = 5000;
const PERSONAL_RELIEF = 2400;
const MEAL_EXEMPTION_LIMIT = 5000;

// Helper to get date from month/year
const getMonthEndDate = (month, year) => {
  return new Date(year, monthNames.indexOf(month) + 1, 0);
};
// Helper to compare month/year with payroll period
const isInPayrollPeriod = (
  startMonth,
  startYear,
  endMonth,
  endYear,
  targetMonth,
  targetYear,
) => {
  const targetMonthIndex = monthNames.indexOf(targetMonth);
  const startMonthIndex = monthNames.indexOf(startMonth);

  // Convert to comparable numbers (year * 12 + month index)
  const targetValue = targetYear * 12 + targetMonthIndex;
  const startValue = startYear * 12 + startMonthIndex;

  // Check if target is after or equal to start
  if (targetValue < startValue) return false;

  // If no end date (recurring), it's valid
  if (!endMonth || !endYear) return true;

  const endMonthIndex = monthNames.indexOf(endMonth);
  const endValue = endYear * 12 + endMonthIndex;

  // Check if target is before or equal to end
  return targetValue <= endValue;
};

// Helper to check if employee was active during payroll period
const isEmployeeActiveDuringPeriod = (employee, payrollMonth, payrollYear) => {
  const payrollEndDate = getMonthEndDate(payrollMonth, payrollYear);
  const hireDate = new Date(employee.hire_date);

  // Must be hired on or before payroll period end
  if (hireDate > payrollEndDate) return false;

  // Check contract end date if exists
  if (employee.employee_contracts?.end_date) {
    const contractEndDate = new Date(employee.employee_contracts.end_date);
    if (contractEndDate < payrollEndDate) return false;
  }

  // Check status effective date for exclusions
  if (employee.employee_status_effective_date) {
    const statusEffectiveDate = new Date(
      employee.employee_status_effective_date,
    );
    const excludedStatuses = ["TERMINATED", "SUSPENDED", "RETIRED"];

    if (excludedStatuses.includes(employee.employee_status)) {
      if (statusEffectiveDate <= payrollEndDate) return false;
    }
  }

  return true;
};

// --- Statutory Calculation Functions ---
const calculatePAYE = (taxableIncome, isDisabled = false) => {
  // Apply disability exemption monthly (150,000 per month)
  let monthlyTaxableIncome = taxableIncome;

  // Apply disability exemption if applicable (annual)
  if (isDisabled) {
    monthlyTaxableIncome = Math.max(0, taxableIncome - DISABILITY_EXEMPTION);
  }

  let tax = 0;

  // Monthly bands
  if (monthlyTaxableIncome <= 24000) {
    tax = monthlyTaxableIncome * 0.1;
  } else if (monthlyTaxableIncome <= 32333) {
    tax = 24000 * 0.1 + (monthlyTaxableIncome - 24000) * 0.25;
  } else if (monthlyTaxableIncome <= 500000) {
    tax = 24000 * 0.1 + 8333 * 0.25 + (monthlyTaxableIncome - 32333) * 0.3;
  } else if (monthlyTaxableIncome <= 800000) {
    tax =
      24000 * 0.1 +
      8333 * 0.25 +
      467667 * 0.3 +
      (monthlyTaxableIncome - 500000) * 0.325;
  } else {
    tax =
      24000 * 0.1 +
      8333 * 0.25 +
      467667 * 0.3 +
      300000 * 0.325 +
      (monthlyTaxableIncome - 800000) * 0.35;
  }

  // Apply personal relief
  const finalTax = tax - PERSONAL_RELIEF;
  return parseFloat(Math.max(0, finalTax).toFixed(2));
};

const calculateNSSF = (
  pensionablePay,
  payrollMonth,
  payrollYear,
  employeeType,
) => {
  const payrollMonthIndex = monthNames.indexOf(payrollMonth);
  let tier1_cap, tier2_cap;
  const nssf_rate = 0.06;

  // Consultants don't pay NSSF through payroll
  if (employeeType === "Consultant") return { tier1: 0, tier2: 0, total: 0 };

  // Date-based caps (NSSF Phased Implementation)
  if (payrollYear > 2026 || (payrollYear === 2026 && payrollMonthIndex >= 1)) {
    // Year 4: Feb 2026 -
    tier1_cap = 9000;
    tier2_cap = 108000;
  } else if (
    payrollYear > 2025 ||
    (payrollYear === 2025 && payrollMonthIndex >= 1)
  ) {
    // Year 3: Feb 2025 - Jan 2026
    tier1_cap = 8000;
    tier2_cap = 72000;
  } else if (
    payrollYear > 2024 ||
    (payrollYear === 2024 && payrollMonthIndex >= 1)
  ) {
    // Year 2: Feb 2024 - Jan 2025
    tier1_cap = 7000;
    tier2_cap = 36000;
  } else {
    // Year 1: Feb 2023 - Jan 2024
    tier1_cap = 6000;
    tier2_cap = 18000;
  }

  let tier1_deduction = Math.min(pensionablePay, tier1_cap) * nssf_rate;
  let tier2_deduction = 0;

  if (pensionablePay > tier1_cap) {
    tier2_deduction =
      Math.min(pensionablePay - tier1_cap, tier2_cap - tier1_cap) * nssf_rate;
  }

  return {
    tier1: tier1_deduction,
    tier2: tier2_deduction,
    total: tier1_deduction + tier2_deduction,
  };
};

// Helper function to safely get HELB deduction
const getHelbDeduction = (employee) => {
  if (!employee.pays_helb || !employee.helb_accounts) return 0;

  // If it's an array
  if (Array.isArray(employee.helb_accounts)) {
    const activeHelb = employee.helb_accounts.find(
      (a) => a.status === "ACTIVE",
    );
    return activeHelb ? parseFloat(activeHelb.monthly_deduction) : 0;
  }

  // If it's a single object
  if (employee.helb_accounts.status === "ACTIVE") {
    return parseFloat(employee.helb_accounts.monthly_deduction);
  }

  return 0;
};

const calculateSHIF = (grossSalary, payrollYear, payrollMonth) => {
  const payrollMonthIndex = monthNames.indexOf(payrollMonth);

  // SHIF effective from 1 October 2024
  if (payrollYear < 2024 || (payrollYear === 2024 && payrollMonthIndex < 9)) {
    // October is index 9
    return 0; // No SHIF before October 2024
  }

  return Math.round(grossSalary * 0.0275);
};

const calculateHousingLevy = (grossSalary, payrollYear, payrollMonth) => {
  const payrollMonthIndex = monthNames.indexOf(payrollMonth);

  // Housing Levy effective from 19 March 2024
  // For simplicity, we'll apply from April 2024 onwards
  if (payrollYear < 2024 || (payrollYear === 2024 && payrollMonthIndex < 3)) {
    // April is index 3
    return 0; // No Housing Levy before April 2024
  }
  return Math.round(grossSalary * 0.015);
};

// --- Non-Cash Benefit Calculations ---
const calculateCarBenefit = (carValue) => {
  // Simplified car benefit calculation (2% of car value per month)
  return carValue * 0.02;
};

const calculateMealBenefit = (mealValue) => {
  if (mealValue <= MEAL_EXEMPTION_LIMIT) return 0;
  return mealValue - MEAL_EXEMPTION_LIMIT;
};

const calculateHousingBenefit = (
  houseValue,
  grossPay,
  housingType = "ORDINARY",
) => {
  const fifteenPercentGross = grossPay * 0.15;
  if (housingType === "FARM") {
    // Farm housing might have different calculation rules
    // This is a simplified approach - consult tax expert for exact farm housing rules
    return Math.max(fifteenPercentGross * 0.8, houseValue * 0.7);
  }

  return Math.max(fifteenPercentGross, houseValue);
};

const calculateOtherNonCashBenefit = (benefitValue) => {
  // For other non-cash benefits (not specifically categorized as CAR, MEAL, HOUSING)
  // The first 5000 is exempt, the rest is taxable
  if (benefitValue <= 5000) return 0;
  return benefitValue; // Tax the entire amount if it exceeds the limit
};

// --- Main Payroll Functions ---
export const syncPayroll = async (req, res) => {
  const { companyId } = req.params;
  const {
    month: payrollMonth,
    year: payrollYear,
    payrollRunId: providedRunId,
  } = req.body;
  const userId = req.userId;

  if (!payrollMonth || !payrollYear) {
    return res.status(400).json({ error: "Month and year are required." });
  }

  // Validate month
  if (!monthNames.includes(payrollMonth)) {
    return res.status(400).json({
      error: `Invalid month. Must be one of: ${monthNames.join(", ")}`,
    });
  }

  // Get or validate payroll run
  let payrollRunId = providedRunId;
  let isNewRun = false;
  let existingRun = null;

  if (!payrollRunId) {
    // Check if there's an existing payroll run for this period
    const { data: existingRunData } = await supabase
      .from("payroll_runs")
      .select("id, status")
      .eq("company_id", companyId)
      .eq("payroll_month", payrollMonth)
      .eq("payroll_year", payrollYear)
      .maybeSingle();

    if (existingRunData) {
      payrollRunId = existingRunData.id;
      existingRun = existingRunData;
    } else {
      isNewRun = true;
    }
  } else {
    // Fetch existing run if ID was provided
    const { data: run } = await supabase
      .from("payroll_runs")
      .select("id, status")
      .eq("id", providedRunId)
      .maybeSingle();
    existingRun = run;
  }

  // If we have a run ID (either from body or existing), verify it and check confirmation
  if (!payrollRunId) {
    return res.status(400).json({
      error: "Invalid payroll run",
      message: "No valid payroll run ID provided or found.",
    });
  }

  // Check if eligibility has been confirmed for this run
  const { data: confirmation } = await supabase
    .from("payroll_eligibility_confirmation")
    .select("status")
    .eq("payroll_run_id", payrollRunId)
    .eq("status", "CONFIRMED")
    .maybeSingle();

  if (!confirmation) {
    return res.status(400).json({
      error: "Payroll eligibility not confirmed",
      message: "Please confirm employee eligibility before processing payroll.",
    });
  }

  // Get confirmed eligible employees from eligibility table (not recalculating)
  const { data: confirmedEligibility } = await supabase
    .from("payroll_eligibility")
    .select("employee_id, is_overridden, override_reason")
    .eq("payroll_run_id", payrollRunId)
    .eq("is_eligible", true);

  const confirmedEmployeeIds =
    confirmedEligibility?.map((e) => e.employee_id) || [];

  if (confirmedEmployeeIds.length === 0) {
    return res.status(404).json({
      message: "No eligible employees confirmed for this payroll period.",
    });
  }

  // Check if existing run is locked/approved/paid
  if (existingRun) {
    const blockedStatuses = [
      PAYROLL_STATUS.APPROVED,
      PAYROLL_STATUS.LOCKED,
      PAYROLL_STATUS.PAID,
    ];
    if (blockedStatuses.includes(existingRun.status)) {
      return res.status(403).json({
        error: `Cannot resync payroll with status: ${existingRun.status}`,
        message: `Payroll runs that are ${existingRun.status.toLowerCase()} cannot be modified.`,
      });
    }
  }

  // Start a transaction
  const { error: txError } = await supabase.rpc("begin_transaction");

  try {
    // Generate payroll number if new run
    let auditPayrollNumber;
    let auditPayrollMonth = payrollMonth;
    let auditPayrollYear = payrollYear;

    if (isNewRun) {
      const { count } = await supabase
        .from("payroll_runs")
        .select("*", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("payroll_month", payrollMonth)
        .eq("payroll_year", payrollYear);

      const payrollCount = count || 0;
      const monthNum = String(monthNames.indexOf(payrollMonth) + 1).padStart(
        2,
        "0",
      );
      const sequence = String(payrollCount + 1).padStart(3, "0");
      const payrollNumber = `PR-${payrollYear}${monthNum}-${sequence}`;

      auditPayrollNumber = payrollNumber;

      // Create new payroll run
      const newRunId = uuidv4();
      const { error: createError } = await supabase
        .from("payroll_runs")
        .insert({
          id: newRunId,
          company_id: companyId,
          payroll_number: payrollNumber,
          payroll_month: payrollMonth,
          payroll_year: payrollYear,
          payroll_date: new Date().toISOString().split("T")[0],
          status: "DRAFT",
          created_at: new Date().toISOString(),
        });

      if (createError) throw createError;
      payrollRunId = newRunId;
    } else {
  // For existing runs, fetch the payroll number
  const { data: existingRunData } = await supabase
    .from("payroll_runs")
    .select("payroll_number, payroll_month, payroll_year")
    .eq("id", payrollRunId)
    .single();
  
  if (existingRunData) {
    auditPayrollNumber = existingRunData.payroll_number;
    auditPayrollMonth = existingRunData.payroll_month;
    auditPayrollYear = existingRunData.payroll_year;
  }
}

    // After creating new payroll run, add:
    await createAuditLog({
      entityType: "payroll_run",
      entityId: payrollRunId,
      entityName: `Payroll Run ${auditPayrollNumber} - ${auditPayrollMonth} ${auditPayrollYear}`,
      action: "CREATE",
      performedBy: userId,
      companyId: companyId,
    });

    // IMPORTANT FIX: Instead of deleting all records, we should UPSERT
    // First, get existing payroll details to check for duplicates
    const { data: existingDetails } = await supabase
      .from("payroll_details")
      .select("id, employee_id")
      .eq("payroll_run_id", payrollRunId);

    const existingEmployeeIds = new Set(
      existingDetails?.map((d) => d.employee_id) || [],
    );
    const existingDetailIds = new Map(
      existingDetails?.map((d) => [d.employee_id, d.id]) || [],
    );

    // 4. Fetch ONLY confirmed employees with their relations
    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select(
        `
        *,
        employee_contracts!inner (
          id,
          contract_type,
          start_date,
          end_date,
          contract_status
        ),
        employee_payment_details (
          payment_method,
          bank_name,
          bank_code,
          branch_name,
          branch_code,
          account_number,
          account_name,
          mobile_type,
          phone_number
        ),
        helb_accounts (
          id,
          helb_account_number,
          monthly_deduction,
          current_balance,
          status
        )
      `,
      )
      .eq("company_id", companyId)
      .in("id", confirmedEmployeeIds)
      .eq("employee_contracts.contract_status", "ACTIVE");

    if (employeesError) throw new Error("Failed to fetch employees.");

    // 5. Fetch allowances and deductions with their types
    const [allowancesResult, deductionsResult, absentDaysResult] =
      await Promise.all([
        supabase
          .from("allowances")
          .select(
            `
          *,
          allowance_types!inner (
            code,
            name,
            is_cash,
            is_taxable,
            has_maximum_value,
            maximum_value
          )
        `,
          )
          .eq("company_id", companyId)
          .or(`is_recurring.eq.true,is_recurring.eq.false`),

        supabase
          .from("deductions")
          .select(
            `
          *,
          deduction_types!inner (
            code,
            name,
            is_pre_tax,
            has_maximum_value,
            maximum_value
          )
        `,
          )
          .eq("company_id", companyId)
          .or(`is_recurring.eq.true,is_recurring.eq.false`),

        supabase
          .from("employee_absent_days")
          .select("*")
          .eq("company_id", companyId)
          .eq("month", monthNames.indexOf(payrollMonth) + 1)
          .eq("year", payrollYear),
      ]);

    if (allowancesResult.error) throw new Error("Failed to fetch allowances.");
    if (deductionsResult.error) throw new Error("Failed to fetch deductions.");
    if (absentDaysResult.error) throw new Error("Failed to fetch absent days.");

    // Filter allowances and deductions
    const allAllowances = allowancesResult.data.filter((allowance) =>
      isInPayrollPeriod(
        allowance.start_month,
        allowance.start_year,
        allowance.end_month,
        allowance.end_year,
        payrollMonth,
        payrollYear,
      ),
    );

    const allDeductions = deductionsResult.data.filter((deduction) =>
      isInPayrollPeriod(
        deduction.start_month,
        deduction.start_year,
        deduction.end_month,
        deduction.end_year,
        payrollMonth,
        payrollYear,
      ),
    );

    const absentDaysRecords = absentDaysResult.data || [];
    const absentDaysMap = new Map();
    absentDaysRecords.forEach((record) => {
      absentDaysMap.set(record.employee_id, {
        days: record.absent_days,
        amount: record.total_deduction_amount,
        notes: record.notes,
      });
    });

    // 6.  Calculate payroll for each employee
    const payrollDetailsToUpsert = [];
    let totals = {
      totalGrossPay: 0,
      totalStatutoryDeductions: 0,
      totalPaye: 0,
      totalNetPay: 0,
      totalNSSF: 0,
      totalSHIF: 0,
      totalHousingLevy: 0,
      totalHELB: 0,
    };

    for (const employee of employees) {
      // Get employee type
      const employeeType = employee.employee_type || "Primary Employee";
      const isSecondary = employeeType === "Secondary Employee";
      const isDisabled = employee.has_disability || false;

      // Basic salary
      let basicSalary = parseFloat(employee.salary);

      // Check for absent days
      let absentDaysDeduction = 0;
      let absentDaysCount = 0;
      const absentRecord = absentDaysMap.get(employee.id);
      if (absentRecord) {
        absentDaysCount = absentRecord.days;
        absentDaysDeduction = absentRecord.amount;
        basicSalary = basicSalary - absentDaysDeduction;
      }

      // Process allowances (same as before)
      let cashAllowances = 0;
      let nonCashTaxableBenefits = 0;
      let allowancesDetails = [];

      const employeeAllowances = allAllowances.filter(
        (a) =>
          a.employee_id === employee.id ||
          (a.employee_id === null &&
            a.department_id === employee.department_id) ||
          a.applies_to === "COMPANY",
      );

      for (const allowance of employeeAllowances) {
        let allowanceValue = 0;

        if (allowance.calculation_type === "FIXED") {
          allowanceValue = parseFloat(allowance.value);
        } else if (allowance.calculation_type === "PERCENTAGE") {
          allowanceValue = basicSalary * (parseFloat(allowance.value) / 100);
        }

        if (allowance.allowance_types.has_maximum_value) {
          allowanceValue = Math.min(
            allowanceValue,
            allowance.allowance_types.maximum_value,
          );
        }

        const allowanceCode = allowance.allowance_types.code;
        const isCash = allowance.allowance_types.is_cash;

        if (isCash) {
          cashAllowances += allowanceValue;
          allowancesDetails.push({
            code: allowanceCode,
            name: allowance.allowance_types.name,
            value: allowanceValue,
            type: "CASH",
            is_taxable: allowance.allowance_types.is_taxable,
          });
        } else {
          let taxableValue = 0;
          switch (allowanceCode) {
            case "CAR":
              taxableValue = calculateCarBenefit(allowanceValue);
              nonCashTaxableBenefits += taxableValue;
              allowancesDetails.push({
                code: "CAR",
                name: allowance.allowance_types.name,
                value: taxableValue,
                raw_value: allowanceValue,
                type: "NON_CASH_CAR",
                is_taxable: true,
              });
              break;
            case "MEAL":
              taxableValue = calculateMealBenefit(allowanceValue);
              nonCashTaxableBenefits += taxableValue;
              allowancesDetails.push({
                code: "MEAL",
                name: allowance.allowance_types.name,
                value: taxableValue,
                raw_value: allowanceValue,
                type: "NON_CASH_MEAL",
                is_taxable: taxableValue > 0,
                exempt_amount: taxableValue === 0 ? allowanceValue : 0,
              });
              break;
            case "HOUSING":
              allowancesDetails.push({
                code: "HOUSING",
                name: allowance.allowance_types.name,
                raw_value: allowanceValue,
                housing_type: allowance.metadata?.housing_type || "ORDINARY",
                type: "NON_CASH_HOUSING",
                is_taxable: true,
              });
              continue;
            default:
              taxableValue = calculateOtherNonCashBenefit(allowanceValue);
              allowancesDetails.push({
                code: allowanceCode,
                name: allowance.allowance_types.name,
                value: taxableValue,
                raw_value: allowanceValue,
                type: "NON_CASH_OTHER",
                is_taxable: taxableValue > 0,
              });
          }
          nonCashTaxableBenefits += taxableValue;
        }
      }

      let grossPayForStatutory = basicSalary + cashAllowances;

      const nssfResult = employee.pays_nssf
        ? calculateNSSF(
            grossPayForStatutory,
            payrollMonth,
            payrollYear,
            employeeType,
          )
        : { tier1: 0, tier2: 0, total: 0 };

      const shifDeduction = employee.pays_shif
        ? calculateSHIF(grossPayForStatutory, payrollYear, payrollMonth)
        : 0;
      const housingLevyDeduction = employee.pays_housing_levy
        ? calculateHousingLevy(grossPayForStatutory, payrollYear, payrollMonth)
        : 0;

      let housingBenefit = 0;
      const housingAllowance = allowancesDetails.find(
        (a) => a.code === "HOUSING",
      );
      if (housingAllowance) {
        housingBenefit = calculateHousingBenefit(
          housingAllowance.raw_value,
          grossPayForStatutory,
          housingAllowance.housing_type || "ORDINARY",
        );
        nonCashTaxableBenefits += housingBenefit;
        housingAllowance.value = housingBenefit;
      }

      let totalGrossPay = grossPayForStatutory + nonCashTaxableBenefits;

      // Process deductions (simplified for brevity - keep your existing logic)
      let preTaxDeductions = 0;
      let postTaxDeductions = 0;
      let deductionsDetails = [];
      let insurancePremium = 0;
      let pensionDeduction = 0;
      let hasPensionDeduction = false;
      let insuranceRelief = 0;

      const employeeDeductions = allDeductions.filter(
        (d) =>
          d.employee_id === employee.id ||
          (d.employee_id === null &&
            d.department_id === employee.department_id) ||
          d.applies_to === "COMPANY",
      );

      let helbDeduction = getHelbDeduction(employee);
      postTaxDeductions += helbDeduction;

      for (const deduction of employeeDeductions) {
        let deductionValue = 0;

        if (deduction.calculation_type === "FIXED") {
          deductionValue = parseFloat(deduction.value);
        } else if (deduction.calculation_type === "PERCENTAGE") {
          deductionValue =
            grossPayForStatutory * (parseFloat(deduction.value) / 100);
        }

        if (deduction.deduction_types.has_maximum_value) {
          deductionValue = Math.min(
            deductionValue,
            deduction.deduction_types.maximum_value,
          );
        }

        const deductionCode = deduction.deduction_types.code;
        const isPreTax = deduction.deduction_types.is_pre_tax;

        if (deductionCode === "PENSION") {
          pensionDeduction = deductionValue;
          hasPensionDeduction = true;
        } else {
          if (!isSecondary) {
            if (
              deductionCode === "INS" ||
              deductionCode === "PRMF" ||
              deduction.deduction_types.name.toLowerCase().includes("insurance")
            ) {
              insurancePremium += deductionValue;
            }
          }

          if (deductionCode !== "INS") {
            if (isPreTax) {
              preTaxDeductions += deductionValue;
            } else {
              postTaxDeductions += deductionValue;
            }
          }
        }

        deductionsDetails.push({
          code: deductionCode,
          name: deduction.deduction_types.name,
          value: deductionValue,
          is_pre_tax: isPreTax,
          is_insurance_relief: deductionCode === "INS",
        });
      }

      // Apply pension/NSSF cap logic (keep your existing logic)
      let combinedPensionNssf = nssfResult.total + pensionDeduction;
      if (hasPensionDeduction && combinedPensionNssf > 30000) {
        const cappedCombined = 30000;
        for (const detail of deductionsDetails) {
          if (detail.code === "PENSION") continue;
          if (detail.is_pre_tax && detail.code !== "PENSION") {
            preTaxDeductions += detail.value;
          }
        }
        preTaxDeductions += cappedCombined - nssfResult.total;
      } else if (hasPensionDeduction) {
        for (const detail of deductionsDetails) {
          if (detail.is_pre_tax) preTaxDeductions += detail.value;
        }
      } else {
        for (const detail of deductionsDetails) {
          if (detail.is_pre_tax) preTaxDeductions += detail.value;
        }
      }

      let taxableIncome;
      if (isSecondary) {
        taxableIncome = totalGrossPay - preTaxDeductions;
      } else {
        taxableIncome =
          totalGrossPay -
          nssfResult.total -
          shifDeduction -
          housingLevyDeduction -
          preTaxDeductions;
      }

      let payeTax;
      if (isSecondary) {
        payeTax = parseFloat((taxableIncome * 0.35).toFixed(2));
      } else {
        payeTax = employee.pays_paye
          ? calculatePAYE(taxableIncome, isDisabled)
          : 0;
        insuranceRelief = Math.min(
          insurancePremium * 0.15,
          INSURANCE_RELIEF_CAP,
        );
        insuranceRelief = parseFloat(insuranceRelief.toFixed(2));
        payeTax = parseFloat(Math.max(0, payeTax - insuranceRelief).toFixed(2));
      }

      let totalStatutoryDeductions =
        nssfResult.total + shifDeduction + housingLevyDeduction + payeTax;
      let totalDeductions = totalStatutoryDeductions + postTaxDeductions;
      if (hasPensionDeduction) {
        totalDeductions += pensionDeduction;
      }
      let netPay = totalGrossPay - totalDeductions;

      const paymentDetails = employee.employee_payment_details || {};

      // IMPORTANT: Determine if we need to INSERT or UPDATE
      const isExisting = existingEmployeeIds.has(employee.id);
      const existingDetailId = existingDetailIds.get(employee.id);

      const payrollDetail = {
        id: uuidv4(),
        payroll_run_id: payrollRunId,
        employee_id: employee.id,
        basic_salary: parseFloat(employee.salary),
        total_cash_allowances: cashAllowances,
        total_non_cash_benefits: nonCashTaxableBenefits,
        total_allowances: cashAllowances + nonCashTaxableBenefits,
        total_deductions: totalDeductions,
        total_statutory_deductions: totalStatutoryDeductions,
        total_other_deductions: postTaxDeductions,
        gross_pay: grossPayForStatutory,
        taxable_income: taxableIncome,
        paye_tax: payeTax,
        nssf_deduction: nssfResult.total,
        nssf_tier1_deduction: nssfResult.tier1,
        nssf_tier2_deduction: nssfResult.tier2,
        shif_deduction: shifDeduction,
        helb_deduction: helbDeduction,
        housing_levy_deduction: housingLevyDeduction,
        net_pay: netPay,
        payment_method: paymentDetails.payment_method,
        bank_name: paymentDetails.bank_name,
        branch_name: paymentDetails.branch_name,
        branch_code: paymentDetails.branch_code,
        bank_code: paymentDetails.bank_code,
        account_name: paymentDetails.account_name,
        account_number: paymentDetails.account_number,
        mobile_type: paymentDetails.mobile_type,
        mobile_phone: paymentDetails.phone_number,
        allowances_details: allowancesDetails,
        deductions_details: deductionsDetails,
        insurance_relief: insuranceRelief,
        absent_days: absentDaysCount,
        absent_days_deduction: absentDaysDeduction,
        created_at: new Date().toISOString(),
      };

      if (isExisting && existingDetailId) {
        // UPDATE existing record
        payrollDetailsToUpsert.push({
          ...payrollDetail,
          id: existingDetailId,
          updated_at: new Date().toISOString(),
          _operation: "UPDATE",
        });
      } else {
        // INSERT new record
        payrollDetailsToUpsert.push({
          ...payrollDetail,
          id: uuidv4(),
          created_at: new Date().toISOString(),
          _operation: "INSERT",
        });
      }

      // Update totals
      totals.totalGrossPay += totalGrossPay;
      totals.totalStatutoryDeductions += totalStatutoryDeductions;
      totals.totalPaye += payeTax;
      totals.totalNetPay += netPay;
      totals.totalNSSF += nssfResult.total;
      totals.totalSHIF += shifDeduction;
      totals.totalHousingLevy += housingLevyDeduction;
      totals.totalHELB += helbDeduction;
    }

    // 7. Insert all payroll details
    // Perform UPSERT operations
    for (const detail of payrollDetailsToUpsert) {
      if (detail._operation === "UPDATE") {
        const { _operation, ...updateData } = detail;
        const { error: updateError } = await supabase
          .from("payroll_details")
          .update(updateData)
          .eq("id", detail.id);

        if (updateError) throw updateError;

        // Reset reviews if the record was updated (only if status changed from approved/rejected)
        await resetEmployeeReviewsForUpdate(detail.id);
      } else {
        const { _operation, ...insertData } = detail;
        const { error: insertError } = await supabase
          .from("payroll_details")
          .insert(insertData);

        if (insertError) throw insertError;
      }
    }

    // Find employees that were removed (no longer eligible) and handle their reviews
    const removedEmployeeIds = [...existingEmployeeIds].filter(
      (id) => !confirmedEmployeeIds.includes(id),
    );

    if (removedEmployeeIds.length > 0) {
      // Get payroll detail IDs for removed employees
      const { data: removedDetails } = await supabase
        .from("payroll_details")
        .select("id")
        .eq("payroll_run_id", payrollRunId)
        .in("employee_id", removedEmployeeIds);

      const removedDetailIds = removedDetails?.map((d) => d.id) || [];

      if (removedDetailIds.length > 0) {
        // Delete reviews for removed employees
        const { error: deleteReviewsError } = await supabase
          .from("payroll_reviews")
          .delete()
          .in("payroll_detail_id", removedDetailIds);

        if (deleteReviewsError)
          console.error(
            "Failed to delete reviews for removed employees:",
            deleteReviewsError,
          );

        // Delete payroll details for removed employees
        const { error: deleteDetailsError } = await supabase
          .from("payroll_details")
          .delete()
          .in("id", removedDetailIds);

        if (deleteDetailsError) throw deleteDetailsError;
      }
    }

    // Initialize reviews for NEW employees only
    const newDetails = payrollDetailsToUpsert.filter(
      (d) => d._operation === "INSERT",
    );
    if (newDetails.length > 0) {
      const newDetailIds = newDetails.map((d) => d.id);
      await initializePayrollReviewsForEmployees(
        payrollRunId,
        companyId,
        newDetailIds,
      );
    }

    // Update payroll run totals
    const { error: updateError } = await supabase
      .from("payroll_runs")
      .update({
        total_gross_pay: totals.totalGrossPay,
        total_statutory_deductions: totals.totalStatutoryDeductions,
        total_net_pay: totals.totalNetPay,
        updated_at: new Date().toISOString(),
        status: isNewRun ? "DRAFT" : existingRun?.status || "DRAFT",
      })
      .eq("id", payrollRunId);

    if (updateError) throw updateError;

    // Commit transaction
    await supabase.rpc("commit_transaction");

    res.status(200).json({
      message: isNewRun
        ? "Payroll created successfully."
        : "Payroll synchronized successfully.",
      payrollRunId,
      isNewRun,
      totals,
      stats: {
        inserted: newDetails.length,
        updated: payrollDetailsToUpsert.length - newDetails.length,
        removed: removedEmployeeIds.length,
      },
    });
  } catch (error) {
    await supabase.rpc("rollback_transaction");
    console.error("Payroll sync error:", error);
    res.status(500).json({
      error: "Failed to sync payroll.",
      details: error.message,
    });
  }
};

// Helper function to reset reviews for updated payroll details
async function resetEmployeeReviewsForUpdate(payrollDetailId) {
  try {
    // Get existing reviews for this payroll detail
    const { data: existingReviews, error: fetchError } = await supabase
      .from("payroll_reviews")
      .select("id, status")
      .eq("payroll_detail_id", payrollDetailId);

    if (fetchError) throw fetchError;
    if (!existingReviews || existingReviews.length === 0) return;

    // Only reset reviews that were APPROVED or REJECTED
    const reviewsToReset = existingReviews.filter(
      (review) => review.status !== "PENDING",
    );

    if (reviewsToReset.length > 0) {
      const { error: updateError } = await supabase
        .from("payroll_reviews")
        .update({
          status: "PENDING",
          reviewed_at: null,
        })
        .in(
          "id",
          reviewsToReset.map((r) => r.id),
        );

      if (updateError) throw updateError;

      console.log(
        `Reset ${reviewsToReset.length} reviews for payroll detail ${payrollDetailId}`,
      );
    }
  } catch (error) {
    console.error("Failed to reset reviews:", error);
    // Don't throw - we don't want to fail the entire sync
  }
}

// Helper function to reset reviews for an employee when data changes
async function resetEmployeeReviews(payrollDetailId, existingReviews) {
  if (!existingReviews || existingReviews.size === 0) return;

  // Only reset APPROVED or REJECTED reviews back to PENDING
  const reviewIdsToReset = [];
  existingReviews.forEach((review, reviewerId) => {
    if (review.status !== "PENDING") {
      reviewIdsToReset.push(review.id);
    }
  });

  if (reviewIdsToReset.length > 0) {
    const { error } = await supabase
      .from("payroll_reviews")
      .update({
        status: "PENDING",
        reviewed_at: null,
      })
      .in("id", reviewIdsToReset);

    if (error) {
      console.error("Failed to reset reviews:", error);
      throw error;
    }
  }
}

// Helper function to initialize reviews for specific payroll details
async function initializePayrollReviewsForEmployees(
  payrollRunId,
  companyId,
  payrollDetailIds,
) {
  try {
    // Get all active reviewers for the company
    const { data: reviewers, error: revError } = await supabase
      .from("company_reviewers")
      .select("id, reviewer_level")
      .eq("company_id", companyId)
      .order("reviewer_level", { ascending: true });

    if (revError) throw revError;
    if (!reviewers || reviewers.length === 0) return;

    // Prepare review entries
    const reviewEntries = [];
    payrollDetailIds.forEach((detailId) => {
      reviewers.forEach((reviewer) => {
        reviewEntries.push({
          payroll_detail_id: detailId,
          company_reviewer_id: reviewer.id,
          status: "PENDING",
        });
      });
    });

    // Batch insert
    if (reviewEntries.length > 0) {
      const { error: insertError } = await supabase
        .from("payroll_reviews")
        .insert(reviewEntries);

      if (insertError) throw insertError;
    }
  } catch (error) {
    console.error("Failed to initialize payroll reviews:", error);
    throw error;
  }
}
// Keep other functions but update references
export const completePayrollRun = async (req, res) => {
  const { payrollRunId } = req.params;

  try {
    const { data: run, error: runError } = await supabase
      .from("payroll_runs")
      .select("id, status")
      .eq("id", payrollRunId)
      .maybeSingle();

    if (runError) throw new Error("Failed to fetch payroll run.");
    if (!run) return res.status(404).json({ error: "Payroll run not found." });

    // Allow completion from DRAFT, PREPARED, or UNDER_REVIEW
    const allowedStatuses = ["DRAFT", "PREPARED", "UNDER_REVIEW"];
    if (!allowedStatuses.includes(run.status)) {
      return res.status(400).json({
        error: `Payroll run cannot be completed from status: ${run.status}`,
      });
    }

    // Update HELB balances
    const { data: details } = await supabase
      .from("payroll_details")
      .select("employee_id, helb_deduction")
      .eq("payroll_run_id", payrollRunId)
      .gt("helb_deduction", 0);

    if (details) {
      for (const detail of details) {
        await supabase
          .from("helb_accounts")
          .update({
            current_balance: supabase.raw(
              `current_balance - ${detail.helb_deduction}`,
            ),
            updated_at: new Date().toISOString(),
          })
          .eq("employee_id", detail.employee_id)
          .eq("status", "ACTIVE");
      }
    }

    // Update payroll run status
    const { data: completedRun, error: updateError } = await supabase
      .from("payroll_runs")
      .update({
        status: "COMPLETED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payrollRunId)
      .select()
      .single();

    if (updateError) throw new Error("Failed to complete payroll run.");

    res.status(200).json(completedRun);
  } catch (error) {
    console.error("Complete payroll error:", error);
    res.status(500).json({ error: error.message });
  }
};

export const getPayrollRuns = async (req, res) => {
  const { companyId } = req.params;
  const { page = 1, limit = 10, status, year, search, month } = req.query;

  try {
    let query = supabase
      .from("payroll_runs")
      .select(
        `
        *,
         payroll_details!inner (
          id,
          employee_id,
          gross_pay,
          net_pay
        )
      `,
        { count: "exact" },
      )
      .eq("company_id", companyId);

    // Apply filters
    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    if (year && year !== "all") {
      query = query.eq("payroll_year", parseInt(year));
    }

    if (month) {
      query = query.eq("payroll_month", month);
    }

    if (search) {
      query = query.or(
        `payroll_number.ilike.%${search}%,` + `payroll_month.ilike.%${search}%`,
      );
    }

    // Add pagination
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to = from + parseInt(limit) - 1;

    query = query
      .order("payroll_year", { ascending: false })
      .order("payroll_month", { ascending: false })
      .range(from, to);

    const { data, error, count } = await query;

    if (error) throw error;

    // Transform data
    const runsWithCounts = data.map((run) => ({
      ...run,
      employee_count: run.payroll_details?.length || 0,
      payroll_details: undefined,
    }));

    // If it's a request for checking existing run (no pagination needed), return array
    if (month) {
      return res.status(200).json(runsWithCounts);
    }

    // Get unique years for filter
    const { data: yearsData } = await supabase
      .from("payroll_runs")
      .select("payroll_year")
      .eq("company_id", companyId)
      .order("payroll_year", { ascending: false });

    const availableYears = [
      ...new Set(yearsData?.map((y) => y.payroll_year) || []),
    ];

    res.status(200).json({
      data: runsWithCounts,
      totalItems: count,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
      availableYears,
    });
  } catch (err) {
    console.error("Get payroll runs error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getPayrollReviewSummaries = async (req, res) => {
  const { companyId } = req.params;
  const { runIds } = req.body;

  if (!runIds || !Array.isArray(runIds) || runIds.length === 0) {
    return res.status(400).json({ error: "Invalid or missing run IDs" });
  }

  if (runIds.length > 50) {
    return res
      .status(400)
      .json({ error: "Too many run IDs. Maximum 50 allowed." });
  }

  try {
    console.log(`Fetching review summaries for ${runIds.length} runs`);

    // First, verify the connection by doing a simple test query
    const { error: testError } = await supabase
      .from("payroll_runs")
      .select("id")
      .limit(1);

    if (testError) {
      console.error("Supabase connection test failed:", testError);
      throw new Error(`Database connection failed: ${testError.message}`);
    }

    // Get all payroll details for these runs
    const { data: payrollDetails, error: detailsError } = await supabase
      .from("payroll_details")
      .select("id, payroll_run_id")
      .in("payroll_run_id", runIds);

    if (detailsError) {
      console.error("Payroll details error:", detailsError);
      throw new Error(
        `Failed to fetch payroll details: ${detailsError.message}`,
      );
    }

    const payrollDetailIds = payrollDetails?.map((d) => d.id) || [];

    if (payrollDetailIds.length === 0) {
      return res.json({ summaries: {} });
    }

    // Get all reviews for these payroll details
    const { data: reviews, error: reviewsError } = await supabase
      .from("payroll_reviews")
      .select("status, payroll_detail_id")
      .in("payroll_detail_id", payrollDetailIds);

    if (reviewsError) {
      console.error("Reviews error:", reviewsError);
      throw new Error(`Failed to fetch reviews: ${reviewsError.message}`);
    }

    // Group by payroll run
    const summaries = {};

    runIds.forEach((runId) => {
      summaries[runId] = {
        total_employees: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
        completion_percentage: 0,
        all_approved: false,
        any_rejected: false,
      };
    });

    // Count employees per run
    payrollDetails.forEach((detail) => {
      if (summaries[detail.payroll_run_id]) {
        summaries[detail.payroll_run_id].total_employees++;
      }
    });

    // Process reviews
    reviews.forEach((review) => {
      const detail = payrollDetails.find(
        (d) => d.id === review.payroll_detail_id,
      );
      if (detail && summaries[detail.payroll_run_id]) {
        const runSummary = summaries[detail.payroll_run_id];

        const status = review.status?.toLowerCase() || "";
        if (status === "approved") runSummary.approved++;
        else if (status === "rejected") runSummary.rejected++;
        else if (status === "pending") runSummary.pending++;
      }
    });

    // Calculate completion percentages and status flags
    Object.keys(summaries).forEach((runId) => {
      const summary = summaries[runId];
      const totalReviews =
        summary.approved + summary.rejected + summary.pending;

      if (totalReviews > 0) {
        summary.completion_percentage = Math.round(
          ((summary.approved + summary.rejected) / totalReviews) * 100,
        );
      } else {
        summary.completion_percentage = 0;
      }

      // Determine overall run status
      summary.all_approved =
        summary.pending === 0 && summary.rejected === 0 && summary.approved > 0;
      summary.any_rejected = summary.rejected > 0;
    });

    console.log(
      `Successfully fetched summaries for ${Object.keys(summaries).length} runs`,
    );
    res.json({ summaries });
  } catch (error) {
    console.error("Error in getPayrollReviewSummaries:", {
      message: error.message,
      stack: error.stack,
      companyId,
      runIdsCount: runIds?.length,
    });

    // Return empty summaries instead of error to prevent UI from breaking
    const emptySummaries = {};
    runIds.forEach((runId) => {
      emptySummaries[runId] = {
        total_employees: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
        completion_percentage: 0,
        all_approved: false,
        any_rejected: false,
      };
    });

    res.json({ summaries: emptySummaries });
  }
};

export const getPayrollDetails = async (req, res) => {
  const { runId } = req.params;

  try {
    const { data, error } = await supabase
      .from("payroll_details")
      .select(
        `
        *,
        employee:employee_id (
          first_name,
          last_name,
          employee_number,
          email,
          has_disability
        )
      `,
      )
      .eq("payroll_run_id", runId);

    if (error) throw new Error("Failed to fetch payroll details.");

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const cancelPayrollRun = async (req, res) => {
  const { payrollRunId } = req.params;

  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .update({
        status: "CANCELLED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payrollRunId)
      .in("status", ["DRAFT", "PREPARED"]) // Only allow canceling drafts or prepared
      .select();

    if (error) throw new Error("Failed to cancel payroll run.");

    if (data.length === 0) {
      return res.status(404).json({
        error: "Payroll run not found or cannot be cancelled.",
      });
    }

    res.status(200).json({ message: "Payroll run cancelled successfully." });
  } catch (error) {
    console.error("Cancel payroll error:", error);
    res.status(500).json({ error: error.message });
  }
};

export const getPayrollYears = async (req, res) => {
  const { companyId } = req.params;

  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .select("payroll_year")
      .eq("company_id", companyId)
      .order("payroll_year", { ascending: false });

    if (error) throw new Error("Failed to fetch payroll years.");

    const uniqueYears = [...new Set(data.map((item) => item.payroll_year))];

    res.status(200).json({
      success: true,
      data: uniqueYears,
    });
  } catch (err) {
    console.error("Error fetching payroll years:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payroll years.",
    });
  }
};

// Function to initialize reviews when payroll moves to UNDER_REVIEW
export const initializePayrollReviews = async (payrollRunId, companyId) => {
  try {
    // 1. Get all active reviewers for the company ordered by level
    const { data: reviewers, error: revError } = await supabase
      .from("company_reviewers")
      .select("id, reviewer_level")
      .eq("company_id", companyId)
      .order("reviewer_level", { ascending: true });

    if (revError) throw revError;
    if (!reviewers || reviewers.length === 0) {
      console.log("No reviewers configured for company:", companyId);
      return;
    }

    // 2. Get all newly created payroll details
    const { data: details, error: detError } = await supabase
      .from("payroll_details")
      .select("id")
      .eq("payroll_run_id", payrollRunId);

    if (detError) throw detError;
    if (!details || details.length === 0) return;

    // 3. Prepare review entries (Cross-join: Every reviewer reviews every employee)
    const reviewEntries = [];
    details.forEach((detail) => {
      reviewers.forEach((reviewer) => {
        reviewEntries.push({
          payroll_detail_id: detail.id,
          company_reviewer_id: reviewer.id,
          status: "PENDING",
          //created_at: new Date().toISOString()
        });
      });
    });

    // 4. Batch insert
    const { error: insertError } = await supabase
      .from("payroll_reviews")
      .insert(reviewEntries);

    if (insertError) throw insertError;
  } catch (error) {
    console.error("Critical: Failed to initialize payroll reviews:", error);
  }
};

// Get summary of review progress for a payroll run
export const getPayrollReviewStatus = async (req, res) => {
  const { runId, companyId } = req.params;

  try {
    // Get payroll run info
    const { data: payrollRun, error: payrollError } = await supabase
      .from("payroll_runs")
      .select("payroll_month, payroll_year, payroll_number, status")
      .eq("id", runId)
      .eq("company_id", companyId)
      .single();

    if (payrollError) throw payrollError;

    // Get all company reviewers with their details from company_users
    const { data: companyReviewers, error: reviewersError } = await supabase
      .from("company_reviewers")
      .select(
        `
        id,
        reviewer_level,
        company_user_id,
        company_users!inner (
          full_name,
          email
        )
      `,
      )
      .eq("company_id", companyId)
      .order("reviewer_level", { ascending: true });

    if (reviewersError) throw reviewersError;

    // If no reviewers found, return empty steps
    if (!companyReviewers || companyReviewers.length === 0) {
      return res.json({
        payroll: payrollRun,
        steps: [],
      });
    }

    // Get all payroll details for this run to know total items
    const { data: payrollDetails, error: detailsError } = await supabase
      .from("payroll_details")
      .select("id")
      .eq("payroll_run_id", runId);

    if (detailsError) throw detailsError;

    const payrollDetailIds = payrollDetails.map((d) => d.id);
    const totalItems = payrollDetailIds.length;

    // Get all reviews for this run
    const { data: reviews, error: reviewsError } = await supabase
      .from("payroll_reviews")
      .select(
        `
        status,
        company_reviewer_id
      `,
      )
      .in("payroll_detail_id", payrollDetailIds);

    if (reviewsError) throw reviewsError;

    // Create a map of review counts by reviewer
    const reviewStats = reviews.reduce((acc, review) => {
      if (!acc[review.company_reviewer_id]) {
        acc[review.company_reviewer_id] = {
          approved: 0,
          rejected: 0,
        };
      }

      if (review.status === "APPROVED") {
        acc[review.company_reviewer_id].approved++;
      } else if (review.status === "REJECTED") {
        acc[review.company_reviewer_id].rejected++;
      }

      return acc;
    }, {});

    // Build steps for all reviewers with actual names
    const steps = companyReviewers.map((reviewer) => {
      const stats = reviewStats[reviewer.id] || { approved: 0, rejected: 0 };

      // Use full_name from company_users, fallback to email or level
      const reviewerName =
        reviewer.company_users?.full_name ||
        reviewer.company_users?.email?.split("@")[0] ||
        `Reviewer Level ${reviewer.reviewer_level}`;

      return {
        reviewer_id: reviewer.id,
        reviewer_name: reviewerName,
        reviewer_email: reviewer.company_users?.email || null,
        reviewer_level: reviewer.reviewer_level,
        total_items: totalItems,
        approved_items: stats.approved,
        rejected_items: stats.rejected,
        pending_items: totalItems - stats.approved - stats.rejected,
        completion_percentage:
          totalItems > 0 ? Math.round((stats.approved / totalItems) * 100) : 0,
      };
    });

    res.json({
      payroll: payrollRun,
      steps: steps,
    });
  } catch (error) {
    console.error("Error fetching review status:", error);
    res.status(500).json({ error: "Failed to fetch review status" });
  }
};

export const updateItemReviewStatus = async (req, res) => {
  const { reviewId } = req.params;
  const { status } = req.body; // 'APPROVED', 'REJECTED', or 'PENDING'

  try {
    const { data, error } = await supabase
      .from("payroll_reviews")
      .update({
        status,
        reviewed_at: status === "PENDING" ? null : new Date().toISOString(),
      })
      .eq("id", reviewId)
      .select();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Update failed" });
  }
};

// Add this new function for bulk review updates
export const bulkUpdateReviewStatus = async (req, res) => {
  const { companyId } = req.params;
  const { reviewIds, status } = req.body; // status: 'APPROVED', 'REJECTED', or 'PENDING'

  if (!reviewIds || !Array.isArray(reviewIds) || reviewIds.length === 0) {
    return res.status(400).json({ error: "No review IDs provided." });
  }

  try {
    const { error } = await supabase
      .from("payroll_reviews")
      .update({
        status: status,
        reviewed_at: new Date().toISOString(),
      })
      .in("id", reviewIds);

    if (error) throw error;

    res.json({
      message: `Successfully updated ${reviewIds.length} item(s).`,
    });
  } catch (error) {
    console.error("Bulk update error:", error);
    res.status(500).json({ error: "Bulk update failed" });
  }
};

// Get single payroll run with summary
export const getPayrollRun = async (req, res) => {
  const { runId } = req.params;
  const { companyId } = req.params;

  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .select("*, payroll_details(*)")
      .eq("id", runId)
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: "Payroll run not found." });
    }

    const details = data.payroll_details || [];
    const totals = {
      count: details.length,
      total_gross: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.gross_pay) || 0),
        0,
      ),
      total_net: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.net_pay) || 0),
        0,
      ),
      total_paye: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.paye_tax) || 0),
        0,
      ),
      total_nssf: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.nssf_deduction) || 0),
        0,
      ),
      total_shif: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.shif_deduction) || 0),
        0,
      ),
      total_helb: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.helb_deduction) || 0),
        0,
      ),
      total_housing_levy: details.reduce(
        (acc, curr) => acc + (parseFloat(curr.housing_levy_deduction) || 0),
        0,
      ),
    };

    // Get employee count
    const { count } = await supabase
      .from("payroll_details")
      .select("*", { count: "exact", head: true })
      .eq("payroll_run_id", runId);

    res.status(200).json({
      ...data,
      employee_count: details.length,
      calculated_totals: totals,
    });
  } catch (error) {
    console.error("Get payroll run error:", error);
    res.status(500).json({ error: "Failed to fetch payroll run." });
  }
};

// Update payroll status with validation
export const updatePayrollStatus = async (req, res) => {
  const { companyId, runId } = req.params;
  const { status, reason } = req.body;
  const userId = req.userId;
  const currentStatus = req.payrollStatus;

  // Define valid status transitions
  const validTransitions = {
    DRAFT: ["PREPARED", "UNDER_REVIEW", "CANCELLED"],
    PREPARED: ["UNDER_REVIEW", "DRAFT", "CANCELLED"],
    UNDER_REVIEW: ["APPROVED", "REJECTED", "DRAFT"],
    APPROVED: ["LOCKED", "PAID", "DRAFT"],
    LOCKED: ["PAID", "UNLOCKED"],
    UNLOCKED: ["DRAFT", "LOCKED"],
    PAID: ["COMPLETED"],
    COMPLETED: [],
    CANCELLED: ["DRAFT"],
    REJECTED: ["DRAFT"],
  };

  // Check if transition is valid
  if (!validTransitions[currentStatus]?.includes(status)) {
    return res.status(400).json({
      error: `Cannot transition from ${currentStatus} to ${status}.`,
    });
  }

  try {
    const { data, error } = await supabase
      .from("payroll_runs")
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...(status === "LOCKED" && {
          locked_at: new Date().toISOString(),
          locked_by: userId,
        }),
        ...(status === "UNLOCKED" && { locked_at: null, locked_by: null }),
      })
      .eq("id", runId)
      .select()
      .single();

    if (error) throw error;

    // Enhanced audit log with reason
    await createAuditLog({
      entityType: "payroll_run",
      entityId: runId,
      entityName: `Payroll Run ${runId} - Status changed from ${currentStatus} to ${status}`,
      action: status === "REJECTED" ? "REJECT" : "STATUS_CHANGE",
      performedBy: userId,
      companyId: companyId, // You'll need to extract companyId from params
    });

    res.status(200).json(data);
  } catch (error) {
    console.error("Update payroll status error:", error);
    res.status(500).json({ error: "Failed to update payroll status." });
  }
};

// Lock payroll run
export const lockPayrollRun = async (req, res) => {
  req.body.status = "LOCKED";
  return updatePayrollStatus(req, res);
};

// Unlock payroll run
export const unlockPayrollRun = async (req, res) => {
  req.body.status = "UNLOCKED";
  return updatePayrollStatus(req, res);
};

// Mark as paid
export const markAsPaid = async (req, res) => {
  req.body.status = "PAID";
  return updatePayrollStatus(req, res);
};

// Get payroll summary for dashboard
export const getPayrollSummary = async (req, res) => {
  const { companyId } = req.params;

  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();

    // Get current month payroll
    const { data: currentPayroll } = await supabase
      .from("payroll_runs")
      .select(
        `
        id,
        status,
        total_gross_pay,
        total_net_pay,
        payroll_month,
        payroll_year
      `,
      )
      .eq("company_id", companyId)
      .eq("payroll_month", monthNames[currentMonth])
      .eq("payroll_year", currentYear)
      .maybeSingle();

    // Get pending approvals
    const { count: pendingCount } = await supabase
      .from("payroll_runs")
      .select("*", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", ["PREPARED", "UNDER_REVIEW"]);

    // Get yearly totals
    const { data: yearlyTotals } = await supabase
      .from("payroll_runs")
      .select("total_gross_pay, total_net_pay, status")
      .eq("company_id", companyId)
      .eq("payroll_year", currentYear)
      .in("status", ["PAID", "COMPLETED"]);

    const yearlyGross =
      yearlyTotals?.reduce((sum, run) => sum + (run.total_gross_pay || 0), 0) ||
      0;
    const yearlyNet =
      yearlyTotals?.reduce((sum, run) => sum + (run.total_net_pay || 0), 0) ||
      0;

    res.status(200).json({
      current_month: {
        exists: !!currentPayroll,
        status: currentPayroll?.status || null,
        total_gross: currentPayroll?.total_gross_pay || 0,
        total_net: currentPayroll?.total_net_pay || 0,
      },
      pending_approvals: pendingCount || 0,
      yearly_total_gross: yearlyGross,
      yearly_total_net: yearlyNet,
    });
  } catch (error) {
    console.error("Get payroll summary error:", error);
    res.status(500).json({ error: "Failed to fetch payroll summary." });
  }
};

// Delete payroll run (ADMIN only)
export const deletePayrollRun = async (req, res) => {
  const { runId } = req.params;

  // Only allow deletion of DRAFT or CANCELLED runs
  if (!["DRAFT", "CANCELLED"].includes(req.payrollStatus)) {
    return res.status(400).json({
      error: `Cannot delete payroll run with status: ${req.payrollStatus}`,
    });
  }

  try {
    // Delete payroll details first (cascade should handle this but being explicit)
    await supabase.from("payroll_details").delete().eq("payroll_run_id", runId);

    // Delete the payroll run
    const { error } = await supabase
      .from("payroll_runs")
      .delete()
      .eq("id", runId);

    if (error) throw error;

    res.status(200).json({ message: "Payroll run deleted successfully." });
  } catch (error) {
    console.error("Delete payroll run error:", error);
    res.status(500).json({ error: "Failed to delete payroll run." });
  }
};

export const revertPayrollStatus = async (req, res) => {
  const { runId } = req.params;
  const { targetStatus, reason } = req.body;
  const userId = req.userId;

  try {
    // Fetch current payroll run
    const { data: payrollRun, error: fetchError } = await supabase
      .from("payroll_runs")
      .select("*")
      .eq("id", runId)
      .single();

    if (fetchError) throw fetchError;

    // Define allowed reverts
    const revertRules = {
      [PAYROLL_STATUS.APPROVED]: [
        PAYROLL_STATUS.DRAFT,
        PAYROLL_STATUS.UNDER_REVIEW,
      ],
      [PAYROLL_STATUS.LOCKED]: [PAYROLL_STATUS.APPROVED, PAYROLL_STATUS.DRAFT],
      [PAYROLL_STATUS.PAID]: [], // No revert from PAID
      [PAYROLL_STATUS.UNDER_REVIEW]: [PAYROLL_STATUS.DRAFT],
      [PAYROLL_STATUS.REJECTED]: [PAYROLL_STATUS.DRAFT],
    };

    // Check if revert is allowed
    if (!revertRules[payrollRun.status]?.includes(targetStatus)) {
      return res.status(403).json({
        error: `Cannot revert from ${payrollRun.status} to ${targetStatus}`,
      });
    }

    // Perform the revert
    const { data: updated, error: updateError } = await supabase
      .from("payroll_runs")
      .update({
        status: targetStatus,
        updated_at: new Date().toISOString(),
        ...(targetStatus === PAYROLL_STATUS.DRAFT && {
          locked_at: null,
          locked_by: null,
        }),
      })
      .eq("id", runId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Enhanced audit log for revert with reason
    await createAuditLog({
      entityType: "payroll_run",
      entityId: runId,
      entityName: `Payroll Run ${runId} - Reverted from ${payrollRun.status} to ${targetStatus}`,
      action: "REVERT",
      performedBy: userId,
      companyId: req.params.companyId,
    });

    res.json({
      message: `Payroll reverted to ${targetStatus} successfully`,
      data: updated,
    });
  } catch (error) {
    console.error("Revert error:", error);
    res.status(500).json({ error: "Failed to revert payroll status" });
  }
};

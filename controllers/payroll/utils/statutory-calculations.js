// Statutory calculation utilities
export const STATUTORY_CONSTANTS = {
  DISABILITY_EXEMPTION: 150000,
  INSURANCE_RELIEF_CAP: 5000,
  PERSONAL_RELIEF: 2400,
  MEAL_EXEMPTION_LIMIT: 5000,
  NSSF_RATE: 0.06,
  SHIF_RATE: 0.0275,
  HOUSING_LEVY_RATE: 0.015,
};

export const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export const PAYROLL_STATUS = {
  DRAFT: 'DRAFT',
  PREPARED: 'PREPARED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  LOCKED: 'LOCKED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED'
};

export function calculatePAYE(taxableIncome, isDisabled = false) {
  let monthlyTaxableIncome = taxableIncome;
  
  if (isDisabled) {
    monthlyTaxableIncome = Math.max(0, taxableIncome - STATUTORY_CONSTANTS.DISABILITY_EXEMPTION);
  }

  let tax = 0;

  if (monthlyTaxableIncome <= 24000) {
    tax = monthlyTaxableIncome * 0.1;
  } else if (monthlyTaxableIncome <= 32333) {
    tax = 24000 * 0.1 + (monthlyTaxableIncome - 24000) * 0.25;
  } else if (monthlyTaxableIncome <= 500000) {
    tax = 24000 * 0.1 + 8333 * 0.25 + (monthlyTaxableIncome - 32333) * 0.3;
  } else if (monthlyTaxableIncome <= 800000) {
    tax = 24000 * 0.1 + 8333 * 0.25 + 467667 * 0.3 + (monthlyTaxableIncome - 500000) * 0.325;
  } else {
    tax = 24000 * 0.1 + 8333 * 0.25 + 467667 * 0.3 + 300000 * 0.325 + (monthlyTaxableIncome - 800000) * 0.35;
  }

  const finalTax = tax - STATUTORY_CONSTANTS.PERSONAL_RELIEF;
  return parseFloat(Math.max(0, finalTax).toFixed(2));
}

export function calculateNSSF(pensionablePay, payrollMonth, payrollYear, employeeType) {
  const payrollMonthIndex = monthNames.indexOf(payrollMonth);
  let tier1_cap, tier2_cap;
  const nssf_rate = STATUTORY_CONSTANTS.NSSF_RATE;

  if (employeeType === "Consultant") return { tier1: 0, tier2: 0, total: 0 };

  if (payrollYear > 2026 || (payrollYear === 2026 && payrollMonthIndex >= 1)) {
    tier1_cap = 9000;
    tier2_cap = 108000;
  } else if (payrollYear > 2025 || (payrollYear === 2025 && payrollMonthIndex >= 1)) {
    tier1_cap = 8000;
    tier2_cap = 72000;
  } else if (payrollYear > 2024 || (payrollYear === 2024 && payrollMonthIndex >= 1)) {
    tier1_cap = 7000;
    tier2_cap = 36000;
  } else {
    tier1_cap = 6000;
    tier2_cap = 18000;
  }

  let tier1_deduction = Math.min(pensionablePay, tier1_cap) * nssf_rate;
  let tier2_deduction = 0;

  if (pensionablePay > tier1_cap) {
    tier2_deduction = Math.min(pensionablePay - tier1_cap, tier2_cap - tier1_cap) * nssf_rate;
  }

  return {
    tier1: tier1_deduction,
    tier2: tier2_deduction,
    total: tier1_deduction + tier2_deduction,
  };
}

export function calculateSHIF(grossSalary, payrollYear, payrollMonth) {
  const payrollMonthIndex = monthNames.indexOf(payrollMonth);

  if (payrollYear < 2024 || (payrollYear === 2024 && payrollMonthIndex < 9)) {
    return 0;
  }

  return Math.round(grossSalary * STATUTORY_CONSTANTS.SHIF_RATE);
}

export function calculateHousingLevy(grossSalary, payrollYear, payrollMonth) {
  const payrollMonthIndex = monthNames.indexOf(payrollMonth);

  if (payrollYear < 2024 || (payrollYear === 2024 && payrollMonthIndex < 3)) {
    return 0;
  }
  return Math.round(grossSalary * STATUTORY_CONSTANTS.HOUSING_LEVY_RATE);
}

export function getHelbDeduction(employee) {
  if (!employee.pays_helb || !employee.helb_accounts) return 0;

  if (Array.isArray(employee.helb_accounts)) {
    const activeHelb = employee.helb_accounts.find(a => a.status === "ACTIVE");
    return activeHelb ? parseFloat(activeHelb.monthly_deduction) : 0;
  }

  if (employee.helb_accounts.status === "ACTIVE") {
    return parseFloat(employee.helb_accounts.monthly_deduction);
  }

  return 0;
}

export function getMonthEndDate(month, year) {
  return new Date(year, monthNames.indexOf(month) + 1, 0);
}

export function isInPayrollPeriod(startMonth, startYear, endMonth, endYear, targetMonth, targetYear) {
  const targetMonthIndex = monthNames.indexOf(targetMonth);
  const startMonthIndex = monthNames.indexOf(startMonth);

  if (targetMonthIndex === -1 || startMonthIndex === -1) {
    return false;
  }

  const targetValue = targetYear * 12 + targetMonthIndex;
  const startValue = startYear * 12 + startMonthIndex;

  if (targetValue < startValue) return false;
  if (!endMonth || !endYear) return true;

  const endMonthIndex = monthNames.indexOf(endMonth);
  if (endMonthIndex === -1) return false;

  const endValue = endYear * 12 + endMonthIndex;
  return targetValue <= endValue;
}
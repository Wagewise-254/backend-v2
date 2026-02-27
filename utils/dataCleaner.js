// utils/dataCleaner.js
export const cleanUUIDField = (value) => {
  if (!value || value === "" || value === "null" || value === "undefined") {
    return null;
  }
  return value;
};

export const cleanBooleanField = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1' || value === 'yes';
  }
  return Boolean(value);
};

export const cleanNumberField = (value) => {
  if (!value && value !== 0) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
};

export const cleanTextField = (value) => {
  if (!value || value === "" || value === "null") return null;
  return value;
};

export const cleanEmployeesData = (data) => {
  return {
    // UUID fields
    department_id: cleanUUIDField(data.department_id),
    sub_department_id: cleanUUIDField(data.sub_department_id),
    job_title_id: cleanUUIDField(data.job_title_id),
    reports_to: cleanUUIDField(data.reports_to),
    
    // Required fields
    employee_number: data.employee_number,
    first_name: data.first_name,
    last_name: data.last_name,
    
    // Optional text fields
    middle_name: cleanTextField(data.middle_name),
    email: cleanTextField(data.email),
    phone: cleanTextField(data.phone),
    date_of_birth: cleanTextField(data.date_of_birth),
    gender: cleanTextField(data.gender),
    blood_group: cleanTextField(data.blood_group),
    marital_status: cleanTextField(data.marital_status),
    id_type: cleanTextField(data.id_type),
    id_number: cleanTextField(data.id_number),
    krapin: cleanTextField(data.krapin),
    nssf_number: cleanTextField(data.nssf_number),
    shif_number: cleanTextField(data.shif_number),
    citizenship: cleanTextField(data.citizenship),
    employee_type: cleanTextField(data.employee_type),
    job_type: cleanTextField(data.job_type),
    
    // Numeric fields
    salary: cleanNumberField(data.salary),
    
    // Boolean fields
    has_disability: cleanBooleanField(data.has_disability),
    pays_paye: cleanBooleanField(data.pays_paye),
    pays_nssf: cleanBooleanField(data.pays_nssf),
    pays_shif: cleanBooleanField(data.pays_shif),
    pays_housing_levy: cleanBooleanField(data.pays_housing_levy),
    pays_helb: cleanBooleanField(data.pays_helb),
    
    // Date fields
    hire_date: cleanTextField(data.hire_date),
    employee_status: data.employee_status || "ACTIVE",
    employee_status_effective_date: cleanTextField(data.employee_status_effective_date) || 
                                   cleanTextField(data.hire_date) || 
                                   new Date().toISOString().split('T')[0],
  };
};
// backend/routes/hrRoutes.js
import express from 'express';
import verifyToken from '../middleware/auth.js'
import  {
    getDepartments,
    addDepartment,
    updateDepartment,
    deleteDepartment
} from '../controllers/departmentController.js';
import {
    getEmployees,
    getEmployeeById,
    addEmployee,
    updateEmployee,
    updateEmployeeStatus,
    updateEmployeeSalary,
    deleteEmployee
} from '../controllers/employeeController.js';
import { 
    getKenyanBanks, 
    getEmployeeBankDetails, 
    updateEmployeeBankDetails, 
    deleteEmployeeBankDetails 
} from '../controllers/bankController.js';

const router = express.Router();

// All routes here assume a /api/company/:companyId prefix
// And they all require authentication and company ownership check

// Department Routes
router.get('/:companyId/departments', verifyToken, getDepartments);
router.post('/:companyId/departments', verifyToken, addDepartment);
router.put('/:companyId/departments/:departmentId', verifyToken, updateDepartment);
router.delete('/:companyId/departments/:departmentId', verifyToken, deleteDepartment);

// Employee Routes
router.get('/:companyId/employees', verifyToken, getEmployees);
router.get('/:companyId/employees/:employeeId', verifyToken, getEmployeeById);
router.post('/:companyId/employees', verifyToken, addEmployee);
router.put('/:companyId/employees/:employeeId', verifyToken, updateEmployee);
// Specific update routes for salary and status
router.patch('/:companyId/employees/:employeeId/status', verifyToken, updateEmployeeStatus);
router.patch('/:companyId/employees/:employeeId/salary', verifyToken, updateEmployeeSalary);
router.delete('/:companyId/employees/:employeeId', verifyToken, deleteEmployee);

// New Bank Routes
router.get('/banks', getKenyanBanks); // This route does not need companyId or user verification since it's static data
router.get('/:companyId/employees/:employeeId/bank-details', verifyToken, getEmployeeBankDetails);
router.put('/:companyId/employees/:employeeId/bank-details', verifyToken, updateEmployeeBankDetails);
router.delete('/:companyId/employees/:employeeId/bank-details', verifyToken, deleteEmployeeBankDetails);


export default router;
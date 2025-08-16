import express from 'express';
import {
  getCompanyStatutories,
  getEmployeeStatutories,
  updateEmployeeStatutories
} from '../controllers/statutoryController.js';
import verifyToken from '../middleware/auth.js';

const router = express.Router({ mergeParams: true });

router.get('/:companyId/statutories', verifyToken, getCompanyStatutories);
router.get('/:companyId/employees/:employeeId/statutories', verifyToken, getEmployeeStatutories);
router.put('/:companyId/employees/:employeeId/statutories', verifyToken, updateEmployeeStatutories);

export default router;
import express from 'express';
import {
  getCompanyStatutories,
  getEmployeeStatutories,
  updateEmployeeStatutories
} from '../controllers/statutoryController.js';
import verifyToken from '../middleware/auth.js';

const router = express.Router({ mergeParams: true });

router.get('/statutories', verifyToken, getCompanyStatutories);
router.get('/employees/:employeeId/statutories', verifyToken, getEmployeeStatutories);
router.put('/employees/:employeeId/statutories', verifyToken, updateEmployeeStatutories);

export default router;
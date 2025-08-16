import express from 'express';
import {
  assignDeduction,
  getDeductions,
  getDeductionById,
  updateDeduction,
  removeDeduction
} from '../controllers/deductionController.js';
import verifyToken from '../middleware/auth.js';

const router = express.Router();

router.post('/:companyId/deductions', verifyToken, assignDeduction);
router.get('/:companyId/deductions', verifyToken, getDeductions);
router.get('/:companyId/deductions/:id', verifyToken, getDeductionById);
router.put('/:companyId/deductions/:id', verifyToken, updateDeduction);
router.delete('/:companyId/deductions/:id', verifyToken, removeDeduction);

export default router;
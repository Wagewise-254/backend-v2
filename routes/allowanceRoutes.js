import express from 'express';
import {
  assignAllowance,
  getAllowances,
  getAllowanceById,
  updateAllowance,
  removeAllowance
} from '../controllers/allowanceController.js';
import verifyToken from '../middleware/auth.js';

const router = express.Router();

router.post('/:companyId/allowances', verifyToken, assignAllowance);
router.get('/:companyId/allowances', verifyToken, getAllowances);
router.get('/:companyId/allowances/:id', verifyToken, getAllowanceById);
router.put('/:companyId/allowances/:id', verifyToken, updateAllowance);
router.delete('/:companyId/allowances/:id', verifyToken, removeAllowance);

export default router;
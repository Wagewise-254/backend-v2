import express from 'express';
import {
  createHelbRecord,
  getHelbRecord,
  updateHelbRecord,
  deleteHelbRecord,
} from '../controllers/helbController.js';
import verifyToken from '../middleware/auth.js';

const router = express.Router({ mergeParams: true });

router.post('/:companyId/employees/:employeeId/helb', verifyToken, createHelbRecord);
router.get('/:companyId/employees/:employeeId/helb', verifyToken, getHelbRecord);
router.put('/:companyId/employees/:employeeId/helb', verifyToken, updateHelbRecord);
router.delete('/:companyId/employees/:employeeId/helb', verifyToken, deleteHelbRecord);

export default router;
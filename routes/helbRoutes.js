import express from 'express';
import {
  createHelbRecord,
  getHelbRecord,
  updateHelbRecord,
  deleteHelbRecord,
  getCompanyHelbRecords,
} from '../controllers/helbController.js';
import verifyToken from '../middleware/verifyToken.js';

const router = express.Router({ mergeParams: true });

// Route to get all HELB records for a company
router.get('/:companyId/helb', verifyToken, getCompanyHelbRecords)

router.post('/:companyId/employees/:employeeId/helb', verifyToken, createHelbRecord);
router.get('/:companyId/employees/:employeeId/helb', verifyToken, getHelbRecord);
router.put('/:companyId/employees/:employeeId/helb', verifyToken, updateHelbRecord);
router.delete('/:companyId/employees/:employeeId/helb', verifyToken, deleteHelbRecord);

export default router;
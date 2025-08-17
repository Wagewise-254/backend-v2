import express from 'express';
import {
  createHelbRecord,
  getHelbRecord,
  updateHelbRecord,
  deleteHelbRecord,
  getCompanyHelbRecords,
} from '../controllers/helbController.js';
import verifyToken from '../middleware/auth.js';

const router = express.Router({ mergeParams: true });

// Route to get all HELB records for a company
router.get('/helb', verifyToken, getCompanyHelbRecords)

router.post('/employees/:employeeId/helb', verifyToken, createHelbRecord);
router.get('/employees/:employeeId/helb', verifyToken, getHelbRecord);
router.put('/employees/:employeeId/helb', verifyToken, updateHelbRecord);
router.delete('/employees/:employeeId/helb', verifyToken, deleteHelbRecord);

export default router;
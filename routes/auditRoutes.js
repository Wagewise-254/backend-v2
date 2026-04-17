import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import {
  getCompanyAuditLogs,
  getActions
} from '../controllers/auditController.js';

const router = express.Router();

router.get('/:companyId/audit-logs', verifyToken, getCompanyAuditLogs);
router.get('/:companyId/audit-logs/actions', verifyToken, getActions);

export default router;
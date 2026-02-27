// backend/routes/auditRoutes.js
import express from 'express';
import verifyToken from '../middleware/verifyToken.js';
import {
  getCompanyAuditLogs,
  getAuditLogSummary,
  getEntityTypes
} from '../controllers/auditController.js';

const router = express.Router();

router.get('/:companyId/audit-logs', verifyToken, getCompanyAuditLogs);
router.get('/:companyId/audit-logs/summary', verifyToken, getAuditLogSummary);
router.get('/:companyId/audit-logs/entity-types', verifyToken, getEntityTypes);

export default router;
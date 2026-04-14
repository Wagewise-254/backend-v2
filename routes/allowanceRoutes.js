import express from 'express';
import {
  assignAllowance,
  getAllowancesByMonth,
  getAllowances,
  getAllowanceById,
  updateAllowance,
  removeAllowance,
  generateAllowanceTemplate,
  previewImportAllowances,
  importAllowances,
  bulkDeleteAllowances,
  exportAllowances
} from '../controllers/allowanceController.js';
import verifyToken from '../middleware/verifyToken.js';
import multer from 'multer';

const router = express.Router();
const upload = multer();

router.post('/:companyId/allowances', verifyToken, assignAllowance);
router.get('/:companyId/allowances', verifyToken, getAllowances);
router.get('/:companyId/allowances/template', verifyToken, generateAllowanceTemplate);
router.get('/:companyId/allowances/monthly', verifyToken, getAllowancesByMonth);
router.get('/:companyId/allowances/export', verifyToken, exportAllowances);
router.get('/:companyId/allowances/:id', verifyToken, getAllowanceById);
router.put('/:companyId/allowances/:id', verifyToken, updateAllowance);
router.delete('/:companyId/allowances/:id', verifyToken, removeAllowance);
router.post('/:companyId/allowances/bulk', verifyToken, bulkDeleteAllowances); // New route for bulk deletion
router.post('/:companyId/allowances/import', verifyToken, upload.single('file'), importAllowances);
router.post('/:companyId/allowances/import/preview', verifyToken, upload.single('file'), previewImportAllowances);


export default router;
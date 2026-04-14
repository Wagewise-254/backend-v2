import express from 'express';
import {
  assignDeduction,
  getDeductionsByMonth,
  getDeductions,
  getDeductionById,
  updateDeduction,
  removeDeduction,
  generateDeductionTemplate,
  previewImportDeductions,
  importDeductions,
  bulkDeleteDeductions,
  exportDeductions
} from '../controllers/deductionController.js';
import verifyToken from '../middleware/verifyToken.js';
import multer from 'multer';

const router = express.Router();
const upload = multer();

router.post('/:companyId/deductions', verifyToken, assignDeduction);
router.get('/:companyId/deductions', verifyToken, getDeductions);
router.get('/:companyId/deductions/template', verifyToken, generateDeductionTemplate);
router.get('/:companyId/deductions/monthly', verifyToken, getDeductionsByMonth);
router.get('/:companyId/deductions/export', verifyToken, exportDeductions);
router.get('/:companyId/deductions/:id', verifyToken, getDeductionById);
router.put('/:companyId/deductions/:id', verifyToken, updateDeduction);
router.delete('/:companyId/deductions/:id', verifyToken, removeDeduction);
router.post('/:companyId/deductions/bulk', verifyToken, bulkDeleteDeductions);
router.post('/:companyId/deductions/import', verifyToken, upload.single('file'), importDeductions); 
router.post('/:companyId/deductions/import/preview', verifyToken, upload.single('file'), previewImportDeductions);

export default router;
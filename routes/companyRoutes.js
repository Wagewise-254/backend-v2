// backend/routes/companyRoutes.js
import express from "express";
import { getCompanies, addCompany, updateCompany } from '../controllers/companyController.js'
import verifyToken from '../middleware/auth.js'
import multer from "multer";

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

// All company routes will be protected by the verifyToken middleware
router.get('/', verifyToken, getCompanies);
router.post('/', verifyToken, upload.single('logo'), addCompany);
router.put('/:id', verifyToken, upload.single('logo'), updateCompany);

export default router;
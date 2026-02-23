import express from "express";
import verifyToken from "../middleware/verifyToken.js";
import {
  listCompanyReviewers,
  getEligibleReviewers,
  addCompanyReviewer,
  updateReviewerLevel,
  removeCompanyReviewer,
  reorderReviewers,
} from "../controllers/companyReviewersController.js";

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

// Company Reviewers Management
router.get("/:companyId/reviewers", listCompanyReviewers);
router.get("/:companyId/reviewers/eligible", getEligibleReviewers);
router.post("/:companyId/reviewers", addCompanyReviewer);
router.patch("/:companyId/reviewers/:reviewerId", updateReviewerLevel);
router.delete("/:companyId/reviewers/:reviewerId", removeCompanyReviewer);
router.post("/:companyId/reviewers/reorder", reorderReviewers);

export default router;
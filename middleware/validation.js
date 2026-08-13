// backend/middleware/validation.js

export const validatePayslipRequest = (req, res, next) => {
  const { employeeIds } = req.body;

  if (!employeeIds) {
    return res.status(400).json({ error: 'employeeIds is required' });
  }

  if (!Array.isArray(employeeIds)) {
    return res.status(400).json({ error: 'employeeIds must be an array' });
  }

  if (employeeIds.length === 0) {
    return res.status(400).json({ error: 'employeeIds cannot be empty' });
  }

  // Validate each ID is a string
  const invalidIds = employeeIds.filter(id => typeof id !== 'string' || id.trim() === '');
  if (invalidIds.length > 0) {
    return res.status(400).json({ error: 'All employee IDs must be non-empty strings' });
  }

  next();
};
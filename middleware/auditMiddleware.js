// backend/middleware/auditMiddleware.js
import { createAuditLog } from '../utils/auditLogger.js';

export const auditAction = (entityType, action) => {
  return async (req, res, next) => {
    // Store original json method
    const originalJson = res.json;
    
    // Override json method to capture response data
    res.json = function(data) {
      // Log after successful response
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Determine entity ID based on action and data
        let entityId = null;
        
        if (action === 'SYNC') {
          // For sync operations, the payrollRunId is in the response
          entityId = data.payrollRunId || req.params.runId;
        } else {
          entityId = req.params.runId || data.id;
        }
        
        if (entityId) {
          createAuditLog({
            entityType,
            entityId,
            action,
            performedBy: req.userId,
            newData: {
              ...req.body,
              response: data,
              timestamp: new Date().toISOString()
            }
          }).catch(console.error);
        } else {
          console.error('Cannot create audit log: entityId is null', { action, data, params: req.params });
        }
      }
      
      return originalJson.call(this, data);
    };
    
    next();
  };
};
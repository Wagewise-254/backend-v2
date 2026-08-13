import { createAuditLog } from "../utils/auditLogger.js";

export const auditAction = (entityType, action) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = function (data) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        let entityId = null;

        if (action === "SYNC") {
          entityId = data?.payrollRunId || req.params.runId;
        } else {
          entityId = req.params.runId || data?.id;
        }

        const companyId =
          req.params.companyId ||
          req.body?.companyId ||
          req.query?.companyId;

        if (!entityId) {
          console.error("Cannot create audit log: entityId is null", {
            action,
            data,
            params: req.params,
          });
        } else if (!companyId) {
          console.error("Cannot create audit log: companyId is null", {
            action,
            params: req.params,
            body: req.body,
            query: req.query,
          });
        } else {
          createAuditLog({
            entityType,
            entityId,
            action,
            performedBy: req.userId,
            companyId,
            newData: {
              ...req.body,
              response: data,
              timestamp: new Date().toISOString(),
            },
          }).catch(console.error);
        }
      }

      return originalJson(data);
    };

    next();
  };
};
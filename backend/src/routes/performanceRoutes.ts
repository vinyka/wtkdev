import { Router } from "express";
import PerformanceController from "../controllers/PerformanceController";
import isAuth from "../middleware/isAuth";

const performanceRoutes = Router();

// Get performance dashboard data
performanceRoutes.get("/dashboard", isAuth, PerformanceController.getDashboard);

// Get metrics for specific WhatsApp connection
performanceRoutes.get("/whatsapp/:whatsappId", isAuth, PerformanceController.getWhatsAppMetrics);

// Resolve performance alert
performanceRoutes.post("/alerts/:alertId/resolve", isAuth, PerformanceController.resolveAlert);

// Export metrics for external monitoring
performanceRoutes.get("/export", isAuth, PerformanceController.exportMetrics);

// Get system health status
performanceRoutes.get("/health", PerformanceController.getHealthStatus);

export default performanceRoutes;
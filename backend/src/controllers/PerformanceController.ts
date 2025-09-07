import { Request, Response } from "express";
import { performanceMonitor, PerformanceMonitoringService } from "../services/PerformanceMonitoringService";
import { performanceLogger } from "../utils/enhancedLogger";

export class PerformanceController {
  // Get performance dashboard data
  public static async getDashboard(req: Request, res: Response): Promise<Response> {
    try {
      const dashboard = performanceMonitor.getDashboard();
      
      performanceLogger.logInfo('Performance dashboard accessed', {
        operation: 'dashboard_access',
        metadata: {
          totalConnections: dashboard.summary.totalConnections,
          totalMessages: dashboard.summary.totalMessages,
          alertsCount: dashboard.alerts.length
        }
      });

      return res.json({
        success: true,
        data: dashboard
      });
    } catch (error) {
      performanceLogger.logError(
        error as Error,
        { operation: 'dashboard_access_error' },
        'Error accessing performance dashboard'
      );

      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve performance dashboard'
      });
    }
  }

  // Get metrics for specific WhatsApp connection
  public static async getWhatsAppMetrics(req: Request, res: Response): Promise<Response> {
    try {
      const { whatsappId } = req.params;
      const metrics = performanceMonitor.getWhatsAppMetrics(parseInt(whatsappId));

      if (!metrics) {
        return res.status(404).json({
          success: false,
          error: 'WhatsApp connection metrics not found'
        });
      }

      performanceLogger.logInfo('WhatsApp metrics accessed', {
        whatsappId: parseInt(whatsappId),
        operation: 'whatsapp_metrics_access'
      });

      return res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      performanceLogger.logError(
        error as Error,
        { 
          operation: 'whatsapp_metrics_access_error',
          whatsappId: parseInt(req.params.whatsappId)
        },
        'Error accessing WhatsApp metrics'
      );

      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve WhatsApp metrics'
      });
    }
  }

  // Resolve performance alert
  public static async resolveAlert(req: Request, res: Response): Promise<Response> {
    try {
      const { alertId } = req.params;
      performanceMonitor.resolveAlert(alertId);

      performanceLogger.logInfo('Performance alert resolved', {
        operation: 'alert_resolution',
        metadata: { alertId }
      });

      return res.json({
        success: true,
        message: 'Alert resolved successfully'
      });
    } catch (error) {
      performanceLogger.logError(
        error as Error,
        { 
          operation: 'alert_resolution_error',
          metadata: { alertId: req.params.alertId }
        },
        'Error resolving performance alert'
      );

      return res.status(500).json({
        success: false,
        error: 'Failed to resolve alert'
      });
    }
  }

  // Export metrics for external monitoring
  public static async exportMetrics(req: Request, res: Response): Promise<Response> {
    try {
      const metrics = performanceMonitor.exportMetrics();

      performanceLogger.logInfo('Performance metrics exported', {
        operation: 'metrics_export',
        metadata: {
          systemMetricsCount: metrics.system.length,
          performanceMetricsCount: metrics.performance.length,
          whatsappMetricsCount: metrics.whatsapp.length,
          alertsCount: metrics.alerts.length
        }
      });

      // Set headers for file download
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=performance-metrics-${new Date().toISOString().split('T')[0]}.json`);

      return res.json(metrics);
    } catch (error) {
      performanceLogger.logError(
        error as Error,
        { operation: 'metrics_export_error' },
        'Error exporting performance metrics'
      );

      return res.status(500).json({
        success: false,
        error: 'Failed to export metrics'
      });
    }
  }

  // Get system health status
  public static async getHealthStatus(req: Request, res: Response): Promise<Response> {
    try {
      const dashboard = performanceMonitor.getDashboard();
      const currentMemoryUsage = dashboard.systemMetrics.memoryUsage;
      const memoryUsageRatio = currentMemoryUsage.heapUsed / currentMemoryUsage.heapTotal;
      
      const health = {
        status: 'healthy',
        timestamp: new Date(),
        metrics: {
          memoryUsage: {
            used: currentMemoryUsage.heapUsed,
            total: currentMemoryUsage.heapTotal,
            percentage: Math.round(memoryUsageRatio * 100)
          },
          uptime: dashboard.systemMetrics.uptime,
          connections: dashboard.summary.totalConnections,
          errorRate: dashboard.summary.errorRate,
          averageResponseTime: dashboard.summary.averageProcessingTime
        },
        alerts: dashboard.alerts.length,
        issues: []
      };

      // Determine health status based on metrics
      const issues: string[] = [];
      
      if (memoryUsageRatio > 0.9) {
        health.status = 'critical';
        issues.push('Critical memory usage');
      } else if (memoryUsageRatio > 0.8) {
        health.status = 'warning';
        issues.push('High memory usage');
      }

      if (dashboard.summary.errorRate > 10) {
        health.status = health.status === 'critical' ? 'critical' : 'warning';
        issues.push('High error rate');
      }

      if (dashboard.summary.averageProcessingTime > 5000) {
        health.status = health.status === 'critical' ? 'critical' : 'warning';
        issues.push('Slow response times');
      }

      health.issues = issues;

      performanceLogger.logInfo('Health status checked', {
        operation: 'health_check',
        metadata: {
          status: health.status,
          memoryUsage: memoryUsageRatio,
          errorRate: dashboard.summary.errorRate,
          issuesCount: issues.length
        }
      });

      return res.json({
        success: true,
        data: health
      });
    } catch (error) {
      performanceLogger.logError(
        error as Error,
        { operation: 'health_check_error' },
        'Error checking system health'
      );

      return res.status(500).json({
        success: false,
        error: 'Failed to check system health',
        data: {
          status: 'error',
          timestamp: new Date(),
          issues: ['Health check failed']
        }
      });
    }
  }
}

export default PerformanceController;
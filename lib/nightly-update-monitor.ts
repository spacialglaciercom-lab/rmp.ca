/**
 * Nightly Update Performance Monitor
 * Comprehensive monitoring and alerting system for cost model nightly updates
 */

import { getMongoClient } from "@/server/mongodb";
import { ObjectId } from "mongodb";
import * as fs from "fs/promises";
import * as path from "path";

export interface UpdatePerformanceMetrics {
  updateId: string;
  timestamp: Date;
  duration: number; // seconds
  success: boolean;
  action: string;
  samplesProcessed: number;
  newSamples: number;
  modelAccuracy: {
    before: number;
    after: number;
    improvement: number;
  };
  resourceUsage: {
    memoryPeak: number; // MB
    cpuUsage: number; // percentage
    diskUsage: number; // MB
  };
  errors: string[];
  warnings: string[];
}

export interface TrendAnalysis {
  period: string;
  updatesCount: number;
  successRate: number;
  averageDuration: number;
  averageImprovement: number;
  accuracyTrend: 'improving' | 'declining' | 'stable';
  performanceTrend: 'improving' | 'declining' | 'stable';
}

export interface AlertConfig {
  enabled: boolean;
  thresholds: {
    minSuccessRate: number;
    maxDuration: number;
    minImprovement: number;
    maxConsecutiveFailures: number;
  };
  recipients: string[];
  channels: ('email' | 'slack' | 'webhook')[];
}

export interface MonitoringDashboard {
  currentStatus: {
    lastUpdate: UpdatePerformanceMetrics | null;
    nextScheduled: Date;
    systemHealth: 'healthy' | 'degraded' | 'unhealthy';
    activeAlerts: number;
  };
  performance: {
    last24Hours: TrendAnalysis;
    last7Days: TrendAnalysis;
    last30Days: TrendAnalysis;
  };
  alerts: Array<{
    id: string;
    type: 'warning' | 'critical';
    title: string;
    message: string;
    timestamp: Date;
    acknowledged: boolean;
  }>;
  recommendations: string[];
}

/**
 * Comprehensive nightly update performance monitor
 */
export class NightlyUpdateMonitor {
  private metrics: UpdatePerformanceMetrics[] = [];
  private alerts: Alert[] = [];
  private config: AlertConfig;
  private consecutiveFailures: number = 0;
  private lastSuccessfulUpdate: Date | null = null;

  constructor(config: AlertConfig) {
    this.config = config;
  }

  /**
   * Record update performance metrics
   */
  async recordUpdate(metrics: UpdatePerformanceMetrics): Promise<void> {
    this.metrics.push(metrics);
    
    // Keep only recent metrics (last 90 days)
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    this.metrics = this.metrics.filter(m => m.timestamp > cutoff);

    // Update failure counter
    if (metrics.success) {
      this.consecutiveFailures = 0;
      this.lastSuccessfulUpdate = metrics.timestamp;
    } else {
      this.consecutiveFailures++;
    }

    // Check for alerts
    await this.checkAlerts(metrics);

    // Store in database
    await this.storeMetrics(metrics);

    console.log(`📊 Update recorded: ${metrics.action} - ${metrics.success ? '✅ Success' : '❌ Failed'} (${metrics.duration.toFixed(1)}s)`);
  }

  /**
   * Check for performance alerts
   */
  private async checkAlerts(metrics: UpdatePerformanceMetrics): Promise<void> {
    const alerts: Alert[] = [];

    // Check success rate
    const recentMetrics = this.getRecentMetrics(10);
    const successRate = recentMetrics.filter(m => m.success).length / recentMetrics.length;
    
    if (successRate < this.config.thresholds.minSuccessRate) {
      alerts.push({
        id: `low_success_rate_${Date.now()}`,
        type: 'critical',
        title: 'Low Update Success Rate',
        message: `Success rate dropped to ${(successRate * 100).toFixed(1)}% (threshold: ${(this.config.thresholds.minSuccessRate * 100).toFixed(1)}%)`,
        timestamp: new Date(),
        acknowledged: false
      });
    }

    // Check update duration
    if (metrics.duration > this.config.thresholds.maxDuration) {
      alerts.push({
        id: `long_duration_${Date.now()}`,
        type: 'warning',
        title: 'Update Duration Too Long',
        message: `Update took ${metrics.duration.toFixed(1)}s (threshold: ${this.config.thresholds.maxDuration}s)`,
        timestamp: new Date(),
        acknowledged: false
      });
    }

    // Check model improvement
    if (metrics.modelAccuracy.improvement < this.config.thresholds.minImprovement && metrics.modelAccuracy.after > 0) {
      alerts.push({
        id: `low_improvement_${Date.now()}`,
        type: 'warning',
        title: 'Low Model Improvement',
        message: `Model improvement was only ${(metrics.modelAccuracy.improvement * 100).toFixed(2)}% (threshold: ${(this.config.thresholds.minImprovement * 100).toFixed(2)}%)`,
        timestamp: new Date(),
        acknowledged: false
      });
    }

    // Check consecutive failures
    if (this.consecutiveFailures >= this.config.thresholds.maxConsecutiveFailures) {
      alerts.push({
        id: `consecutive_failures_${Date.now()}`,
        type: 'critical',
        title: 'Consecutive Update Failures',
        message: `${this.consecutiveFailures} consecutive update failures detected`,
        timestamp: new Date(),
        acknowledged: false
      });
    }

    // Add alerts and send notifications
    for (const alert of alerts) {
      this.alerts.push(alert);
      await this.sendAlert(alert);
    }
  }

  /**
   * Get performance trends
   */
  getTrendAnalysis(period: '24h' | '7d' | '30d'): TrendAnalysis {
    const hours = period === '24h' ? 24 : period === '7d' ? 7 * 24 : 30 * 24;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const periodMetrics = this.metrics.filter(m => m.timestamp > cutoff);
    
    if (periodMetrics.length === 0) {
      return {
        period,
        updatesCount: 0,
        successRate: 0,
        averageDuration: 0,
        averageImprovement: 0,
        accuracyTrend: 'stable',
        performanceTrend: 'stable'
      };
    }

    const successCount = periodMetrics.filter(m => m.success).length;
    const successRate = successCount / periodMetrics.length;
    const averageDuration = periodMetrics.reduce((sum, m) => sum + m.duration, 0) / periodMetrics.length;
    const averageImprovement = periodMetrics
      .filter(m => m.modelAccuracy.after > 0)
      .reduce((sum, m) => sum + m.modelAccuracy.improvement, 0) / periodMetrics.length;

    // Analyze trends
    const accuracyTrend = this.calculateTrend(
      periodMetrics.filter(m => m.modelAccuracy.after > 0).map(m => m.modelAccuracy.after)
    );
    
    const performanceTrend = this.calculateTrend(
      periodMetrics.map(m => m.duration)
    );

    return {
      period,
      updatesCount: periodMetrics.length,
      successRate,
      averageDuration,
      averageImprovement,
      accuracyTrend,
      performanceTrend
    };
  }

  /**
   * Calculate trend direction
   */
  private calculateTrend(values: number[]): 'improving' | 'declining' | 'stable' {
    if (values.length < 3) return 'stable';

    // Simple linear regression
    const n = values.length;
    const xSum = values.reduce((sum, _, i) => sum + i, 0);
    const ySum = values.reduce((sum, val) => sum + val, 0);
    const xySum = values.reduce((sum, val, i) => sum + i * val, 0);
    const x2Sum = values.reduce((sum, _, i) => sum + i * i, 0);

    const slope = (n * xySum - xSum * ySum) / (n * x2Sum - xSum * xSum);
    
    if (Math.abs(slope) < 0.01) return 'stable';
    return slope > 0 ? 'improving' : 'declining';
  }

  /**
   * Get monitoring dashboard data
   */
  async getDashboard(): Promise<MonitoringDashboard> {
    const lastUpdate = this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
    const nextScheduled = this.calculateNextScheduledUpdate();
    const systemHealth = this.calculateSystemHealth();
    const activeAlerts = this.alerts.filter(a => !a.acknowledged).length;

    const performance = {
      last24Hours: this.getTrendAnalysis('24h'),
      last7Days: this.getTrendAnalysis('7d'),
      last30Days: this.getTrendAnalysis('30d')
    };

    const recommendations = this.generateRecommendations();

    return {
      currentStatus: {
        lastUpdate,
        nextScheduled,
        systemHealth,
        activeAlerts
      },
      performance,
      alerts: this.alerts.slice(-10), // Last 10 alerts
      recommendations
    };
  }

  /**
   * Calculate system health
   */
  private calculateSystemHealth(): 'healthy' | 'degraded' | 'unhealthy' {
    const recentMetrics = this.getRecentMetrics(5);
    
    if (recentMetrics.length === 0) return 'unhealthy';

    const successRate = recentMetrics.filter(m => m.success).length / recentMetrics.length;
    const avgDuration = recentMetrics.reduce((sum, m) => sum + m.duration, 0) / recentMetrics.length;
    const hasRecentUpdate = this.lastSuccessfulUpdate && 
      (Date.now() - this.lastSuccessfulUpdate.getTime()) < 48 * 60 * 60 * 1000;

    if (successRate >= 0.8 && avgDuration < 300 && hasRecentUpdate) {
      return 'healthy';
    } else if (successRate >= 0.6 && avgDuration < 600) {
      return 'degraded';
    } else {
      return 'unhealthy';
    }
  }

  /**
   * Generate recommendations based on performance
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const trends = this.getTrendAnalysis('7d');

    if (trends.successRate < 0.8) {
      recommendations.push("Investigate update failures and improve error handling");
    }

    if (trends.averageImprovement < 0.01) {
      recommendations.push("Consider collecting more diverse training data");
    }

    if (trends.averageDuration > 300) {
      recommendations.push("Optimize update process to reduce duration");
    }

    if (this.consecutiveFailures > 0) {
      recommendations.push("Check system health and resolve update issues");
    }

    if (trends.accuracyTrend === 'declining') {
      recommendations.push("Model accuracy is declining - consider retraining with more data");
    }

    if (recommendations.length === 0) {
      recommendations.push("System performance is stable - continue current monitoring");
    }

    return recommendations;
  }

  /**
   * Get recent metrics
   */
  private getRecentMetrics(count: number): UpdatePerformanceMetrics[] {
    return this.metrics.slice(-count);
  }

  /**
   * Calculate next scheduled update
   */
  private calculateNextScheduledUpdate(): Date {
    // Assuming nightly updates at 2 AM
    const now = new Date();
    const nextUpdate = new Date(now);
    nextUpdate.setHours(2, 0, 0, 0);
    
    if (nextUpdate <= now) {
      nextUpdate.setDate(nextUpdate.getDate() + 1);
    }
    
    return nextUpdate;
  }

  /**
   * Store metrics in database
   */
  private async storeMetrics(metrics: UpdatePerformanceMetrics): Promise<void> {
    const client = getMongoClient();
    if (!client) return;

    try {
      const db = client.db("trashroute");
      const collection = db.collection("update_performance_metrics");
      
      await collection.insertOne({
        ...metrics,
        _id: new ObjectId()
      });
    } catch (error) {
      console.error("Error storing metrics:", error);
    }
  }

  /**
   * Send alert notifications
   */
  private async sendAlert(alert: Alert): Promise<void> {
    if (!this.config.enabled) return;

    console.log(`🚨 ALERT: ${alert.title} - ${alert.message}`);

    // Send to configured channels
    for (const channel of this.config.channels) {
      try {
        switch (channel) {
          case 'email':
            await this.sendEmailAlert(alert);
            break;
          case 'slack':
            await this.sendSlackAlert(alert);
            break;
          case 'webhook':
            await this.sendWebhookAlert(alert);
            break;
        }
      } catch (error) {
        console.error(`Failed to send ${channel} alert:`, error);
      }
    }
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(alert: Alert): Promise<void> {
    // Email implementation would go here
    console.log(`📧 Email alert would be sent to: ${this.config.recipients.join(', ')}`);
    console.log(`Subject: [${alert.type.toUpperCase()}] ${alert.title}`);
    console.log(`Body: ${alert.message}`);
  }

  /**
   * Send Slack alert
   */
  private async sendSlackAlert(alert: Alert): Promise<void> {
    // Slack implementation would go here
    console.log(`💬 Slack alert would be sent to configured channels`);
    console.log(`Message: ${alert.title} - ${alert.message}`);
  }

  /**
   * Send webhook alert
   */
  private async sendWebhookAlert(alert: Alert): Promise<void> {
    // Webhook implementation would go here
    console.log(`🌐 Webhook alert would be sent to configured endpoints`);
    console.log(`Payload: ${JSON.stringify(alert, null, 2)}`);
  }

  /**
   * Acknowledge alert
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  /**
   * Get alert statistics
   */
  getAlertStats(): {
    total: number;
    critical: number;
    warning: number;
    acknowledged: number;
    unacknowledged: number;
  } {
    return {
      total: this.alerts.length,
      critical: this.alerts.filter(a => a.type === 'critical').length,
      warning: this.alerts.filter(a => a.type === 'warning').length,
      acknowledged: this.alerts.filter(a => a.acknowledged).length,
      unacknowledged: this.alerts.filter(a => !a.acknowledged).length
    };
  }

  /**
   * Export performance data
   */
  async exportPerformanceData(startDate: Date, endDate: Date): Promise<UpdatePerformanceMetrics[]> {
    return this.metrics.filter(m => 
      m.timestamp >= startDate && m.timestamp <= endDate
    );
  }

  /**
   * Generate performance report
   */
  async generateReport(period: 'daily' | 'weekly' | 'monthly'): Promise<string> {
    const trends = this.getTrendAnalysis(period === 'daily' ? '24h' : period === 'weekly' ? '7d' : '30d');
    const alertStats = this.getAlertStats();
    const dashboard = await this.getDashboard();

    const report = `
# Cost Model Update Performance Report
**Period:** ${period} (${trends.period})
**Generated:** ${new Date().toISOString()}

## Summary
- **Updates:** ${trends.updatesCount}
- **Success Rate:** ${(trends.successRate * 100).toFixed(1)}%
- **Average Duration:** ${trends.averageDuration.toFixed(1)}s
- **Average Improvement:** ${(trends.averageImprovement * 100).toFixed(2)}%
- **System Health:** ${dashboard.currentStatus.systemHealth.toUpperCase()}

## Performance Trends
- **Accuracy Trend:** ${trends.accuracyTrend}
- **Performance Trend:** ${trends.performanceTrend}

## Alerts
- **Total Alerts:** ${alertStats.total}
- **Critical:** ${alertStats.critical}
- **Warning:** ${alertStats.warning}
- **Unacknowledged:** ${alertStats.unacknowledged}

## Recommendations
${dashboard.recommendations.map(rec => `- ${rec}`).join('\n')}

## Next Steps
${dashboard.currentStatus.systemHealth === 'healthy' ? 
  'Continue current monitoring and maintenance schedule.' :
  'Address system health issues and review update process.'}
    `;

    return report.trim();
  }
}

interface Alert {
  id: string;
  type: 'warning' | 'critical';
  title: string;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
}

// Default configuration
export const defaultMonitoringConfig: AlertConfig = {
  enabled: true,
  thresholds: {
    minSuccessRate: 0.8,
    maxDuration: 300, // 5 minutes
    minImprovement: 0.005, // 0.5%
    maxConsecutiveFailures: 3
  },
  recipients: ['admin@trashroute.com'],
  channels: ['email', 'webhook']
};

// Export singleton instance
export const nightlyUpdateMonitor = new NightlyUpdateMonitor(defaultMonitoringConfig);
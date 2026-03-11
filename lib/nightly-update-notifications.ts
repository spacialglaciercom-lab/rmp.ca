/**
 * Nightly Update Notifications and Reporting
 * Comprehensive notification system for cost model updates
 */

import { getMongoClient } from "@/server/mongodb";
import { ObjectId } from "mongodb";
import * as fs from "fs/promises";
import * as path from "path";

export interface NotificationConfig {
  enabled: boolean;
  channels: ("email" | "slack" | "webhook" | "sms" | "push")[];
  recipients: {
    email: string[];
    slack: string[];
    webhook: string[];
    sms: string[];
    push: string[];
  };
  triggers: {
    onSuccess: boolean;
    onFailure: boolean;
    onWarning: boolean;
    onRollback: boolean;
  };
  templates: {
    success: string;
    failure: string;
    warning: string;
    rollback: string;
  };
}

export interface NotificationMessage {
  id: string;
  type: "success" | "failure" | "warning" | "rollback" | "report";
  title: string;
  content: string;
  timestamp: Date;
  priority: "low" | "medium" | "high" | "critical";
  channels: string[];
  recipients: string[];
  metadata: {
    updateId?: string;
    modelVersion?: string;
    performanceMetrics?: any;
    errorDetails?: any;
  };
}

export interface UpdateReport {
  reportId: string;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalUpdates: number;
    successfulUpdates: number;
    failedUpdates: number;
    averageDuration: number;
    averageImprovement: number;
  };
  details: {
    dailyBreakdown: Array<{
      date: string;
      updates: number;
      successRate: number;
      averageDuration: number;
    }>;
    topAlerts: Array<{
      type: string;
      count: number;
      message: string;
    }>;
    modelPerformance: {
      accuracyTrend: "improving" | "declining" | "stable";
      improvementRate: number;
      stabilityScore: number;
    };
  };
  recommendations: string[];
  nextSteps: string[];
  generatedAt: Date;
}

export interface AutomatedReportConfig {
  enabled: boolean;
  schedule: "daily" | "weekly" | "monthly";
  formats: ("json" | "pdf" | "html" | "csv")[];
  recipients: string[];
  includeCharts: boolean;
  includeRawData: boolean;
  retentionDays: number;
}

/**
 * Comprehensive notification system for nightly updates
 */
export class NightlyUpdateNotificationSystem {
  private config: NotificationConfig;
  private notificationHistory: NotificationMessage[] = [];
  private retryQueue: NotificationMessage[] = [];
  private maxRetries = 3;

  constructor(config: NotificationConfig) {
    this.config = config;
  }

  /**
   * Send notification based on update result
   */
  async sendUpdateNotification(
    updateResult: any,
    modelVersion: string,
    performanceMetrics?: any,
  ): Promise<void> {
    if (!this.config.enabled) return;

    try {
      const message = this.createUpdateMessage(
        updateResult,
        modelVersion,
        performanceMetrics,
      );

      // Determine which channels to use
      const channels = this.selectChannels(message.type);
      const recipients = this.selectRecipients(message.type);

      message.channels = channels;
      message.recipients = recipients;

      // Send notification
      await this.sendNotification(message);

      // Store in history
      this.storeNotification(message);
    } catch (error) {
      console.error("Failed to send update notification:", error);
    }
  }

  /**
   * Create notification message based on update result
   */
  private createUpdateMessage(
    updateResult: any,
    modelVersion: string,
    performanceMetrics?: any,
  ): NotificationMessage {
    const timestamp = new Date();
    const id = `update_${timestamp.getTime()}`;

    let type: NotificationMessage["type"];
    let title: string;
    let content: string;
    let priority: NotificationMessage["priority"] = "medium";

    if (updateResult.success) {
      type = "success";
      title = `Cost Model Update Successful - Version ${modelVersion}`;
      content = this.formatSuccessMessage(updateResult, performanceMetrics);

      if (updateResult.metrics?.modelAccuracy?.improvement > 0.05) {
        priority = "high";
      }
    } else {
      type = "failure";
      title = `Cost Model Update Failed - Version ${modelVersion}`;
      content = this.formatFailureMessage(updateResult);
      priority = "critical";
    }

    return {
      id,
      type,
      title,
      content,
      timestamp,
      priority,
      channels: [],
      recipients: [],
      metadata: {
        updateId: updateResult.updateId,
        modelVersion,
        performanceMetrics,
      },
    };
  }

  /**
   * Format success message
   */
  private formatSuccessMessage(
    updateResult: any,
    performanceMetrics?: any,
  ): string {
    const { metrics, newModel } = updateResult;

    return `
🎉 **Cost Model Update Successful**

**Summary:**
- Update ID: ${metrics.updateId}
- Model Version: ${newModel?.version || "N/A"}
- Duration: ${metrics.duration.toFixed(1)} seconds
- Samples Processed: ${metrics.samplesProcessed}
- New Samples: ${metrics.newSamples}

**Performance:**
- Previous Accuracy: ${(metrics.modelAccuracy?.before * 100).toFixed(1)}%
- New Accuracy: ${(metrics.modelAccuracy?.after * 100).toFixed(1)}%
- Improvement: ${(metrics.modelAccuracy?.improvement * 100).toFixed(2)}%

**Next Steps:**
- Monitor model performance in production
- Review update metrics in dashboard
- Continue regular data collection

**Timestamp:** ${new Date().toISOString()}
    `.trim();
  }

  /**
   * Format failure message
   */
  private formatFailureMessage(updateResult: any): string {
    const { metrics, errors } = updateResult;

    return `
❌ **Cost Model Update Failed**

**Summary:**
- Update ID: ${metrics.updateId}
- Duration: ${metrics.duration.toFixed(1)} seconds
- Error Count: ${errors?.length || 0}

**Errors:**
${errors?.map((error: string, index: number) => `${index + 1}. ${error}`).join("\n") || "No specific errors available"}

**Recommended Actions:**
1. Check system logs for detailed error information
2. Verify data quality and sources
3. Review model configuration
4. Consider manual intervention if needed

**Next Steps:**
- System will retry update at next scheduled time
- Monitor for consecutive failures
- Manual review may be required

**Timestamp:** ${new Date().toISOString()}
    `.trim();
  }

  /**
   * Send notification through configured channels
   */
  private async sendNotification(message: NotificationMessage): Promise<void> {
    const promises = message.channels.map((channel) =>
      this.sendToChannel(channel, message),
    );

    try {
      await Promise.allSettled(promises);
      console.log(`📤 Notification sent: ${message.title}`);
    } catch (error) {
      console.error("Failed to send notification:", error);

      // Add to retry queue
      this.addToRetryQueue(message);
    }
  }

  /**
   * Send notification to specific channel
   */
  private async sendToChannel(
    channel: string,
    message: NotificationMessage,
  ): Promise<void> {
    switch (channel) {
      case "email":
        await this.sendEmail(message);
        break;
      case "slack":
        await this.sendSlack(message);
        break;
      case "webhook":
        await this.sendWebhook(message);
        break;
      case "sms":
        await this.sendSMS(message);
        break;
      case "push":
        await this.sendPush(message);
        break;
      default:
        console.warn(`Unknown notification channel: ${channel}`);
    }
  }

  /**
   * Send email notification
   */
  private async sendEmail(message: NotificationMessage): Promise<void> {
    const recipients = this.config.recipients.email;
    if (recipients.length === 0) return;

    const emailContent = this.formatEmailContent(message);

    console.log(
      `📧 Email notification would be sent to: ${recipients.join(", ")}`,
    );
    console.log(`Subject: ${message.title}`);
    console.log(`Content:\n${emailContent}`);

    // In production, integrate with email service (SendGrid, AWS SES, etc.)
    // For now, we'll create an email file for demonstration
    const emailPath = path.join(
      process.cwd(),
      "notifications",
      "emails",
      `${message.id}.html`,
    );
    await fs.mkdir(path.dirname(emailPath), { recursive: true });
    await fs.writeFile(emailPath, emailContent);
  }

  /**
   * Send Slack notification
   */
  private async sendSlack(message: NotificationMessage): Promise<void> {
    const channels = this.config.recipients.slack;
    if (channels.length === 0) return;

    const slackContent = this.formatSlackContent(message);

    console.log(
      `💬 Slack notification would be sent to channels: ${channels.join(", ")}`,
    );
    console.log(`Content:\n${slackContent}`);

    // In production, integrate with Slack API
    // For now, we'll create a log file
    const slackPath = path.join(
      process.cwd(),
      "notifications",
      "slack",
      `${message.id}.json`,
    );
    await fs.mkdir(path.dirname(slackPath), { recursive: true });
    await fs.writeFile(
      slackPath,
      JSON.stringify(
        {
          channels,
          text: slackContent,
          blocks: this.createSlackBlocks(message),
        },
        null,
        2,
      ),
    );
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(message: NotificationMessage): Promise<void> {
    const webhooks = this.config.recipients.webhook;
    if (webhooks.length === 0) return;

    const webhookPayload = this.createWebhookPayload(message);

    console.log(
      `🌐 Webhook notification would be sent to: ${webhooks.join(", ")}`,
    );
    console.log(`Payload:\n${JSON.stringify(webhookPayload, null, 2)}`);

    // In production, make HTTP requests to webhooks
    // For now, we'll create a payload file
    const webhookPath = path.join(
      process.cwd(),
      "notifications",
      "webhooks",
      `${message.id}.json`,
    );
    await fs.mkdir(path.dirname(webhookPath), { recursive: true });
    await fs.writeFile(webhookPath, JSON.stringify(webhookPayload, null, 2));
  }

  /**
   * Send SMS notification
   */
  private async sendSMS(message: NotificationMessage): Promise<void> {
    const phoneNumbers = this.config.recipients.sms;
    if (phoneNumbers.length === 0) return;

    const smsContent = this.formatSMSContent(message);

    console.log(
      `📱 SMS notification would be sent to: ${phoneNumbers.join(", ")}`,
    );
    console.log(`Message: ${smsContent}`);

    // In production, integrate with SMS service (Twilio, AWS SNS, etc.)
    // For now, we'll create an SMS file
    const smsPath = path.join(
      process.cwd(),
      "notifications",
      "sms",
      `${message.id}.txt`,
    );
    await fs.mkdir(path.dirname(smsPath), { recursive: true });
    await fs.writeFile(smsPath, smsContent);
  }

  /**
   * Send push notification
   */
  private async sendPush(message: NotificationMessage): Promise<void> {
    const pushTokens = this.config.recipients.push;
    if (pushTokens.length === 0) return;

    const pushContent = this.formatPushContent(message);

    console.log(
      `🔔 Push notification would be sent to: ${pushTokens.length} devices`,
    );
    console.log(`Content: ${JSON.stringify(pushContent, null, 2)}`);

    // In production, integrate with push notification service (FCM, APNs, etc.)
    // For now, we'll create a push payload file
    const pushPath = path.join(
      process.cwd(),
      "notifications",
      "push",
      `${message.id}.json`,
    );
    await fs.mkdir(path.dirname(pushPath), { recursive: true });
    await fs.writeFile(pushPath, JSON.stringify(pushContent, null, 2));
  }

  /**
   * Format content for different channels
   */
  private formatEmailContent(message: NotificationMessage): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background-color: #f4f4f4; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .footer { background-color: #f4f4f4; padding: 10px; text-align: center; font-size: 12px; }
    .success { color: #28a745; }
    .failure { color: #dc3545; }
    .warning { color: #ffc107; }
    .timestamp { color: #6c757d; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>RouteMasterPro Cost Model Update</h1>
  </div>
  
  <div class="content">
    <h2 class="${message.type}">${message.title}</h2>
    
    <div class="timestamp">
      Generated: ${message.timestamp.toISOString()}
    </div>
    
    <div class="message-content">
      ${message.content.replace(/\n/g, "<br>")}
    </div>
    
    ${
      message.metadata.updateId
        ? `
    <div class="metadata">
      <strong>Update ID:</strong> ${message.metadata.updateId}<br>
      <strong>Model Version:</strong> ${message.metadata.modelVersion || "N/A"}
    </div>
    `
        : ""
    }
  </div>
  
  <div class="footer">
    This is an automated notification from RouteMasterPro Cost Model Update System.<br>
    Please do not reply to this email.
  </div>
</body>
</html>
    `.trim();
  }

  private formatSlackContent(message: NotificationMessage): string {
    return `*${message.title}*

${message.content}

${message.metadata.updateId ? `Update ID: \`${message.metadata.updateId}\`` : ""}
Timestamp: ${message.timestamp.toISOString()}`;
  }

  private createSlackBlocks(message: NotificationMessage): any[] {
    const color =
      message.type === "success"
        ? "good"
        : message.type === "failure"
          ? "danger"
          : "warning";

    return [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: message.title,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: message.content,
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Details",
          },
          url: `#update/${message.metadata.updateId}`,
          style: message.type === "failure" ? "danger" : "primary",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*Priority:* ${message.priority.toUpperCase()} | *Timestamp:* ${message.timestamp.toISOString()}`,
          },
        ],
      },
    ];
  }

  private createWebhookPayload(message: NotificationMessage): any {
    return {
      event: "cost_model_update",
      type: message.type,
      timestamp: message.timestamp.toISOString(),
      data: {
        title: message.title,
        content: message.content,
        priority: message.priority,
        metadata: message.metadata,
      },
      recipients: message.recipients,
    };
  }

  private formatSMSContent(message: NotificationMessage): string {
    return `${message.title}\n\n${message.content.substring(0, 140)}${message.content.length > 140 ? "..." : ""}\n\n${message.timestamp.toLocaleTimeString()}`;
  }

  private formatPushContent(message: NotificationMessage): any {
    return {
      notification: {
        title: message.title,
        body:
          message.content.substring(0, 100) +
          (message.content.length > 100 ? "..." : ""),
        icon: "trash-icon",
        badge: 1,
        sound: "default",
        priority: message.priority === "critical" ? "high" : "normal",
      },
      data: {
        type: message.type,
        updateId: message.metadata.updateId || "",
        timestamp: message.timestamp.toISOString(),
      },
    };
  }

  /**
   * Select channels based on message type and priority
   */
  private selectChannels(messageType: NotificationMessage["type"]): string[] {
    const channels = [...this.config.channels];

    // Add additional channels for critical messages
    if (messageType === "failure") {
      if (!channels.includes("sms")) channels.push("sms");
      if (!channels.includes("push")) channels.push("push");
    }

    return channels;
  }

  /**
   * Select recipients based on message type
   */
  private selectRecipients(messageType: NotificationMessage["type"]): string[] {
    // For critical failures, send to all configured recipients
    if (messageType === "failure") {
      return [
        ...this.config.recipients.email,
        ...this.config.recipients.slack,
        ...this.config.recipients.webhook,
        ...this.config.recipients.sms,
        ...this.config.recipients.push,
      ];
    }

    // For other messages, use configured recipients
    return [];
  }

  /**
   * Store notification in history
   */
  private storeNotification(message: NotificationMessage): void {
    this.notificationHistory.push(message);

    // Keep only recent history (last 1000 notifications)
    if (this.notificationHistory.length > 1000) {
      this.notificationHistory = this.notificationHistory.slice(-1000);
    }
  }

  /**
   * Add message to retry queue
   */
  private addToRetryQueue(message: NotificationMessage): void {
    const retryMessage = {
      ...message,
      id: `${message.id}_retry_${Date.now()}`,
      metadata: {
        ...message.metadata,
        retryCount: (message.metadata.retryCount || 0) + 1,
        originalId: message.id,
      },
    };

    this.retryQueue.push(retryMessage);

    // Process retry queue
    setTimeout(() => this.processRetryQueue(), 60000); // Retry after 1 minute
  }

  /**
   * Process retry queue
   */
  private async processRetryQueue(): Promise<void> {
    const messages = [...this.retryQueue];
    this.retryQueue = [];

    for (const message of messages) {
      const retryCount = message.metadata.retryCount || 0;

      if (retryCount < this.maxRetries) {
        try {
          await this.sendNotification(message);
        } catch (error) {
          console.error(
            `Retry ${retryCount} failed for message ${message.id}:`,
            error,
          );

          if (retryCount + 1 < this.maxRetries) {
            this.addToRetryQueue(message);
          }
        }
      }
    }
  }

  /**
   * Generate automated report
   */
  async generateAutomatedReport(
    period: "daily" | "weekly" | "monthly",
    config: AutomatedReportConfig,
  ): Promise<void> {
    if (!config.enabled) return;

    console.log(`📊 Generating ${period} automated report...`);

    try {
      const report = await this.createReport(period);

      // Generate different formats
      for (const format of config.formats) {
        await this.generateReportFormat(report, format, config);
      }

      // Send to recipients
      await this.sendReport(report, config.recipients);

      console.log(`✅ ${period} report generated and sent successfully`);
    } catch (error) {
      console.error(`Failed to generate ${period} report:`, error);
    }
  }

  /**
   * Create report data
   */
  private async createReport(
    period: "daily" | "weekly" | "monthly",
  ): Promise<UpdateReport> {
    const endDate = new Date();
    const startDate = new Date(endDate);

    switch (period) {
      case "daily":
        startDate.setDate(startDate.getDate() - 1);
        break;
      case "weekly":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "monthly":
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    }

    // Get data for the period
    const updates = this.getUpdatesForPeriod(startDate, endDate);

    // Generate report content
    return {
      reportId: `report_${period}_${Date.now()}`,
      period: { start: startDate, end: endDate },
      summary: this.calculateSummary(updates),
      details: this.calculateDetails(updates, period),
      recommendations: this.generateReportRecommendations(updates),
      nextSteps: this.generateNextSteps(updates),
      generatedAt: new Date(),
    };
  }

  /**
   * Get updates for specific period
   */
  private getUpdatesForPeriod(startDate: Date, endDate: Date): any[] {
    return this.notificationHistory.filter(
      (n) =>
        n.type === "success" ||
        (n.type === "failure" &&
          n.timestamp >= startDate &&
          n.timestamp <= endDate),
    );
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(updates: any[]): UpdateReport["summary"] {
    const totalUpdates = updates.length;
    const successfulUpdates = updates.filter(
      (u) => u.type === "success",
    ).length;
    const failedUpdates = updates.filter((u) => u.type === "failure").length;

    const averageDuration =
      updates.reduce((sum, u) => {
        return sum + (u.metadata.performanceMetrics?.duration || 0);
      }, 0) / totalUpdates;

    const averageImprovement =
      updates.reduce((sum, u) => {
        return sum + (u.metadata.performanceMetrics?.improvement || 0);
      }, 0) / totalUpdates;

    return {
      totalUpdates,
      successfulUpdates,
      failedUpdates,
      averageDuration,
      averageImprovement,
    };
  }

  /**
   * Calculate detailed breakdown
   */
  private calculateDetails(
    updates: any[],
    period: string,
  ): UpdateReport["details"] {
    // Group by day for daily breakdown
    const dailyBreakdown: any[] = [];
    const alerts: any[] = [];

    // This would be implemented based on actual data structure
    // For now, return placeholder structure
    return {
      dailyBreakdown,
      topAlerts: alerts,
      modelPerformance: {
        accuracyTrend: "stable",
        improvementRate: 0.02,
        stabilityScore: 0.85,
      },
    };
  }

  /**
   * Generate report recommendations
   */
  private generateReportRecommendations(updates: any[]): string[] {
    const recommendations: string[] = [];

    const successRate =
      updates.filter((u) => u.type === "success").length / updates.length;

    if (successRate < 0.8) {
      recommendations.push(
        "Success rate below target - investigate update failures",
      );
      recommendations.push("Review error handling and retry mechanisms");
    }

    if (updates.length === 0) {
      recommendations.push("No updates during period - check system status");
    }

    recommendations.push("Continue monitoring system performance");
    recommendations.push("Review data collection quality");

    return recommendations;
  }

  /**
   * Generate next steps
   */
  private generateNextSteps(updates: any[]): string[] {
    return [
      "Schedule next automated report",
      "Review and act on recommendations",
      "Monitor system health dashboard",
      "Update notification preferences if needed",
    ];
  }

  /**
   * Generate report in specific format
   */
  private async generateReportFormat(
    report: UpdateReport,
    format: string,
    config: AutomatedReportConfig,
  ): Promise<void> {
    const filename = `cost_model_report_${report.period.start.toISOString().split("T")[0]}.${format}`;
    const reportPath = path.join(process.cwd(), "reports", format, filename);

    await fs.mkdir(path.dirname(reportPath), { recursive: true });

    switch (format) {
      case "json":
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
        break;

      case "html":
        await fs.writeFile(reportPath, this.formatHTMLReport(report, config));
        break;

      case "csv":
        await fs.writeFile(reportPath, this.formatCSVReport(report));
        break;

      default:
        console.warn(`Unsupported report format: ${format}`);
    }

    console.log(`Report saved: ${reportPath}`);
  }

  /**
   * Format HTML report
   */
  private formatHTMLReport(
    report: UpdateReport,
    config: AutomatedReportConfig,
  ): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Cost Model Update Report - ${report.period.start.toDateString()}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .header { background-color: #f4f4f4; padding: 20px; text-align: center; }
    .summary { background-color: #e9ecef; padding: 15px; margin: 20px 0; }
    .section { margin: 20px 0; }
    .recommendations { background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; }
    .footer { text-align: center; margin-top: 40px; font-size: 12px; color: #6c757d; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Cost Model Update Report</h1>
    <p>Period: ${report.period.start.toDateString()} to ${report.period.end.toDateString()}</p>
  </div>
  
  <div class="summary">
    <h2>Summary</h2>
    <p>Total Updates: ${report.summary.totalUpdates}</p>
    <p>Success Rate: ${((report.summary.successfulUpdates / report.summary.totalUpdates) * 100).toFixed(1)}%</p>
    <p>Average Duration: ${report.summary.averageDuration.toFixed(1)}s</p>
    <p>Average Improvement: ${(report.summary.averageImprovement * 100).toFixed(2)}%</p>
  </div>
  
  <div class="section">
    <h2>Recommendations</h2>
    <ul>
      ${report.recommendations.map((rec) => `<li>${rec}</li>`).join("")}
    </ul>
  </div>
  
  <div class="section">
    <h2>Next Steps</h2>
    <ul>
      ${report.nextSteps.map((step) => `<li>${step}</li>`).join("")}
    </ul>
  </div>
  
  <div class="footer">
    Generated by RouteMasterPro Cost Model Update System<br>
    ${report.generatedAt.toISOString()}
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Format CSV report
   */
  private formatCSVReport(report: UpdateReport): string {
    const headers = [
      "Date",
      "Total Updates",
      "Successful",
      "Failed",
      "Success Rate",
      "Avg Duration",
      "Avg Improvement",
    ];

    const data = [
      report.period.start.toISOString().split("T")[0],
      report.summary.totalUpdates.toString(),
      report.summary.successfulUpdates.toString(),
      report.summary.failedUpdates.toString(),
      (
        (report.summary.successfulUpdates / report.summary.totalUpdates) *
        100
      ).toFixed(1),
      report.summary.averageDuration.toFixed(1),
      (report.summary.averageImprovement * 100).toFixed(2),
    ];

    return [headers.join(","), data.join(",")].join("\n");
  }

  /**
   * Send report to recipients
   */
  private async sendReport(
    report: UpdateReport,
    recipients: string[],
  ): Promise<void> {
    const reportMessage: NotificationMessage = {
      id: `report_${Date.now()}`,
      type: "report",
      title: `Cost Model ${report.period.start.toDateString()} Report`,
      content: this.formatReportSummary(report),
      timestamp: new Date(),
      priority: "medium",
      channels: ["email"],
      recipients: recipients,
      metadata: {
        reportId: report.reportId,
        period: report.period,
      },
    };

    await this.sendNotification(reportMessage);
  }

  /**
   * Format report summary
   */
  private formatReportSummary(report: UpdateReport): string {
    return `
📊 **Cost Model Update Report**

**Period:** ${report.period.start.toDateString()} to ${report.period.end.toDateString()}

**Summary:**
- Total Updates: ${report.summary.totalUpdates}
- Success Rate: ${((report.summary.successfulUpdates / report.summary.totalUpdates) * 100).toFixed(1)}%
- Average Duration: ${report.summary.averageDuration.toFixed(1)}s
- Average Improvement: ${(report.summary.averageImprovement * 100).toFixed(2)}%

**Key Insights:**
${report.recommendations.map((rec) => `• ${rec}`).join("\n")}

**Next Steps:**
${report.nextSteps.map((step) => `• ${step}`).join("\n")}

Full report available in system dashboard.
    `.trim();
  }

  /**
   * Store notification in database
   */
  private async storeNotification(message: NotificationMessage): Promise<void> {
    const client = getMongoClient();
    if (!client) return;

    try {
      const db = client.db("trashroute");
      const collection = db.collection("notification_history");

      await collection.insertOne({
        ...message,
        _id: new ObjectId(),
      });
    } catch (error) {
      console.error("Error storing notification:", error);
    }
  }

  /**
   * Get notification history
   */
  async getNotificationHistory(
    limit: number = 100,
  ): Promise<NotificationMessage[]> {
    return this.notificationHistory.slice(-limit);
  }

  /**
   * Get notification statistics
   */
  getNotificationStats(): {
    total: number;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
    last24Hours: number;
  } {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const byType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let last24HoursCount = 0;

    this.notificationHistory.forEach((msg) => {
      byType[msg.type] = (byType[msg.type] || 0) + 1;
      byPriority[msg.priority] = (byPriority[msg.priority] || 0) + 1;

      if (msg.timestamp > last24Hours) {
        last24HoursCount++;
      }
    });

    return {
      total: this.notificationHistory.length,
      byType,
      byPriority,
      last24Hours: last24HoursCount,
    };
  }
}

// Default configuration
export const defaultNotificationConfig: NotificationConfig = {
  enabled: true,
  channels: ["email", "webhook"],
  recipients: {
    email: ["admin@trashroute.com"],
    slack: ["#updates"],
    webhook: ["https://api.trashroute.com/webhooks/updates"],
    sms: [],
    push: [],
  },
  triggers: {
    onSuccess: true,
    onFailure: true,
    onWarning: true,
    onRollback: true,
  },
  templates: {
    success:
      "🎉 Cost model update successful! Version {{version}} deployed with {{improvement}}% improvement.",
    failure:
      "❌ Cost model update failed. Error: {{error}}. Manual intervention required.",
    warning:
      "⚠️ Cost model update completed with warnings. Check details: {{details}}",
    rollback:
      "🔄 Cost model rollback performed from {{fromVersion}} to {{toVersion}}. Reason: {{reason}}",
  },
};

// Export singleton instance
export const nightlyUpdateNotificationSystem =
  new NightlyUpdateNotificationSystem(defaultNotificationConfig);

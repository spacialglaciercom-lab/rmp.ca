/**
 * AI Route Analysis Router — Post-Route AI Parser
 *
 * Combines PostGIS spatial analysis with Vercel AI Gateway to provide
 * actionable logistics insights. This is the "operational goldmine" that
 * translates raw spatial data into recommendations.
 *
 * Flow:
 * 1. Client requests analysis for a route
 * 2. PostGIS generates logistics report (spatial math → human-readable)
 * 3. AI Gateway receives report and provides intelligent recommendations
 * 4. Client receives actionable insights
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { generateLogisticsReport, formatReportForAI, LogisticsReport } from "./logisticsReportService";
import { chatWithAiGateway } from "./aiProxy";
import { createLogger } from "./logger";

const log = createLogger("ai-route-analysis");

/**
 * System prompt for the AI to analyze logistics reports.
 * Tuned for waste collection / route optimization domain.
 */
const LOGISTICS_ANALYSIS_PROMPT = `You are an expert logistics analyst specializing in waste collection route optimization and the Chinese Postman Problem. 

Analyze the provided logistics report and give actionable recommendations. Focus on:
1. Route efficiency improvements
2. Time and fuel savings opportunities  
3. Driver workload balancing
4. Coverage gaps and isolated points
5. Priority sequencing for remaining stops

Be concise and practical. Use bullet points. Avoid jargon. Provide specific, actionable advice.`;

/**
 * Extended analysis prompt for detailed reports.
 */
const DETAILED_ANALYSIS_PROMPT = `${LOGISTICS_ANALYSIS_PROMPT}

Additionally, provide:
- Estimated time savings if recommendations are followed
- Risk assessment for current route configuration
- Alternative route suggestions if efficiency is below 70%
- Specific coordinates to prioritize or avoid`;

export const aiRouteAnalysisRouter = router({
  /**
   * Generate a logistics report from PostGIS spatial data.
   * This is the raw spatial analysis without AI insights.
   */
  getLogisticsReport: publicProcedure
    .input(
      z.object({
        driverLng: z.number(),
        driverLat: z.number(),
        includeCollected: z.boolean().default(false),
      })
    )
    .query(async ({ input }) => {
      log.info("Generating logistics report", {
        driverLng: input.driverLng,
        driverLat: input.driverLat,
        includeCollected: input.includeCollected,
      });

      const report = await generateLogisticsReport({
        driverLng: input.driverLng,
        driverLat: input.driverLat,
        includeCollected: input.includeCollected,
      });

      return report;
    }),

  /**
   * Get AI-powered route analysis.
   * Combines PostGIS logistics report with LLM insights.
   * Requires authentication (protected procedure).
   */
  analyzeRoute: protectedProcedure
    .input(
      z.object({
        driverLng: z.number(),
        driverLat: z.number(),
        includeCollected: z.boolean().default(false),
        detailed: z.boolean().default(false),
        customPrompt: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      log.info("AI route analysis requested", {
        driverLng: input.driverLng,
        driverLat: input.driverLat,
        includeCollected: input.includeCollected,
        detailed: input.detailed,
      });

      // Step 1: Generate logistics report from PostGIS
      const report = await generateLogisticsReport({
        driverLng: input.driverLng,
        driverLat: input.driverLat,
        includeCollected: input.includeCollected,
      });

      // Step 2: Format report for AI consumption
      const reportText = formatReportForAI(report);

      // Step 3: Build the prompt
      const systemPrompt = input.detailed 
        ? DETAILED_ANALYSIS_PROMPT 
        : LOGISTICS_ANALYSIS_PROMPT;

      const userPrompt = input.customPrompt
        ? `${reportText}\n\nAdditional context: ${input.customPrompt}`
        : reportText;

      // Step 4: Send to AI Gateway for analysis
      try {
        const aiAnalysis = await chatWithAiGateway(
          [{ role: "user", content: userPrompt }],
          systemPrompt,
          {
            maxOutputTokens: input.detailed ? 1024 : 512,
            temperature: 0.7, // Slightly creative for recommendations
          }
        );

        log.info("AI analysis complete", {
          efficiencyScore: report.efficiency.routeEfficiencyScore,
          remainingPoints: report.summary.remainingCount,
        });

        return {
          report,
          aiAnalysis,
          metadata: {
            model: "openai/gpt-4o-mini",
            generatedAt: new Date().toISOString(),
            promptTokens: reportText.length,
          },
        };
      } catch (error) {
        log.error("AI analysis failed", {
          error: error instanceof Error ? error.message : String(error),
        });

        // Return the report even if AI fails
        return {
          report,
          aiAnalysis: null,
          error: error instanceof Error ? error.message : "AI analysis failed",
          metadata: {
            model: "openai/gpt-4o-mini",
            generatedAt: new Date().toISOString(),
            promptTokens: reportText.length,
          },
        };
      }
    }),

  /**
   * Quick efficiency check — returns just the efficiency score.
   * Useful for dashboard widgets or real-time monitoring.
   */
  getEfficiencyScore: publicProcedure
    .input(
      z.object({
        driverLng: z.number(),
        driverLat: z.number(),
      })
    )
    .query(async ({ input }) => {
      const report = await generateLogisticsReport({
        driverLng: input.driverLng,
        driverLat: input.driverLat,
        includeCollected: false,
      });

      return {
        score: report.efficiency.routeEfficiencyScore,
        backtrackingRisk: report.efficiency.backtrackingRisk,
        remainingCount: report.summary.remainingCount,
        estimatedMinutes: report.summary.estimatedTimeMinutes,
      };
    }),

  /**
   * Get hotspot zones for route planning.
   * Returns areas with high collection point density.
   */
  getHotspots: publicProcedure
    .input(
      z.object({
        driverLng: z.number(),
        driverLat: z.number(),
        minPoints: z.number().default(3),
      })
    )
    .query(async ({ input }) => {
      const report = await generateLogisticsReport({
        driverLng: input.driverLng,
        driverLat: input.driverLat,
        includeCollected: false,
      });

      const filteredHotspots = report.hotspots.filter(
        (h) => h.pointCount >= input.minPoints
      );

      return {
        hotspots: filteredHotspots,
        totalClusters: report.spatialAnalysis.clusterCount,
        isolatedPoints: report.spatialAnalysis.isolatedPoints,
      };
    }),

  /**
   * Compare current route efficiency against historical baseline.
   * Requires org membership (orgProcedure) for historical data access.
   */
  compareEfficiency: protectedProcedure
    .input(
      z.object({
        driverLng: z.number(),
        driverLat: z.number(),
        baselineScore: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const report = await generateLogisticsReport({
        driverLng: input.driverLng,
        driverLat: input.driverLat,
        includeCollected: false,
      });

      const currentScore = report.efficiency.routeEfficiencyScore;
      const delta = currentScore - input.baselineScore;
      const improvement = delta > 0;
      const percentChange = input.baselineScore > 0 
        ? Math.round((delta / input.baselineScore) * 100)
        : 0;

      return {
        currentScore,
        baselineScore: input.baselineScore,
        delta,
        percentChange,
        improvement,
        message: improvement
          ? `Route efficiency improved by ${Math.abs(percentChange)}%`
          : `Route efficiency decreased by ${Math.abs(percentChange)}%`,
        recommendations: improvement
          ? ["Continue current route strategy"]
          : report.efficiency.suggestedOptimizations,
      };
    }),
});
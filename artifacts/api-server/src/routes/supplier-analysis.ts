import { Router, type IRouter } from "express";
import { AnalyzeSupplierMessageRequestSchema } from "@workspace/api-zod";
import { extractSupplierFacts, SupplierExtractionError } from "../lib/supplier-extraction";
import { getDailyAiRequestLimit, SupplierAnalysisProtection } from "../lib/supplier-analysis-protection";

const router: IRouter = Router();
const MAX_REQUESTS_PER_WINDOW = 12;
const requestProtection = new SupplierAnalysisProtection({
  maxRequestsPerMinute: MAX_REQUESTS_PER_WINDOW,
  dailyLimit: getDailyAiRequestLimit(),
});

router.post("/analyze-message", async (req, res) => {
  const startedAt = Date.now();
  const parsed = AnalyzeSupplierMessageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide a supplier message containing 1 to 5000 characters." });
    return;
  }
  const clientId = req.ip || req.socket.remoteAddress || "unknown";
  const protectedRequest = requestProtection.reserve(
    clientId,
    parsed.data.message,
    () => extractSupplierFacts(parsed.data.message),
  );
  if (protectedRequest.kind === "minute_limit") {
    res.status(429).json({ error: "Too many AI analyses in one minute. Showing the rule-based result instead." });
    return;
  }
  if (protectedRequest.kind === "daily_limit") {
    res.status(429).json({ error: `Daily AI analysis limit reached (${getDailyAiRequestLimit()} requests). Showing the rule-based result instead.` });
    return;
  }

  try {
    const extraction = await protectedRequest.result;
    res.json({ extraction });
  } catch (error) {
    if (error instanceof SupplierExtractionError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.warn(JSON.stringify({ event: "openai_route_failure", category: "unexpected_error", elapsedMs: Math.max(0, Date.now() - startedAt), selectedModel: null }));
    res.status(502).json({ error: "Supplier message analysis failed. Use the rule-based analyzer instead." });
  }
});

export default router;

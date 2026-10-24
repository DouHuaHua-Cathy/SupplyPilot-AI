import { Router, type IRouter } from "express";
import { AnalyzeSupplierMessageRequestSchema } from "@workspace/api-zod";
import { extractSupplierFacts, SupplierExtractionError } from "../lib/supplier-extraction";

const router: IRouter = Router();
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 12;
const requestsByClient = new Map<string, { startedAt: number; count: number }>();

router.post("/analyze-message", async (req, res) => {
  const startedAt = Date.now();
  const now = Date.now();
  if (requestsByClient.size >= 1000) {
    for (const [id, entry] of requestsByClient) {
      if (now - entry.startedAt >= WINDOW_MS) requestsByClient.delete(id);
    }
    if (requestsByClient.size >= 1000) requestsByClient.delete(requestsByClient.keys().next().value!);
  }
  const clientId = req.ip || req.socket.remoteAddress || "unknown";
  const previous = requestsByClient.get(clientId);
  if (!previous || now - previous.startedAt >= WINDOW_MS) {
    requestsByClient.set(clientId, { startedAt: now, count: 1 });
  } else if (previous.count >= MAX_REQUESTS_PER_WINDOW) {
    res.status(429).json({ error: "Too many analysis requests. Wait a minute and try again." });
    return;
  } else {
    previous.count += 1;
  }

  const parsed = AnalyzeSupplierMessageRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide a supplier message containing 1 to 5000 characters." });
    return;
  }

  try {
    const extraction = await extractSupplierFacts(parsed.data.message);
    res.json({ extraction });
  } catch (error) {
    if (error instanceof SupplierExtractionError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.warn(JSON.stringify({ event: "openrouter_route_failure", category: "unexpected_error", elapsedMs: Math.max(0, Date.now() - startedAt), selectedModel: null }));
    res.status(502).json({ error: "Supplier message analysis failed. Use the rule-based analyzer instead." });
  }
});

export default router;

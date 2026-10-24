import { createHash } from "node:crypto";

export const DEFAULT_DAILY_AI_REQUEST_LIMIT = 25;
export const MAX_DAILY_AI_REQUEST_LIMIT = 1000;
export const AI_REQUEST_DEDUPE_MS = 70_000;

export function getDailyAiRequestLimit(value = process.env.SUPPLIER_AI_DAILY_LIMIT): number {
  if (value === undefined || value.trim() === "") return DEFAULT_DAILY_AI_REQUEST_LIMIT;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_DAILY_AI_REQUEST_LIMIT
    ? parsed
    : DEFAULT_DAILY_AI_REQUEST_LIMIT;
}

type RecentRequest<T> = {
  expiresAt: number;
  result: Promise<T>;
};

export type ProtectedRequest<T> =
  | { kind: "accepted"; result: Promise<T>; deduplicated: boolean }
  | { kind: "minute_limit" }
  | { kind: "daily_limit" };

export class SupplierAnalysisProtection {
  private readonly requestsByClient = new Map<string, { startedAt: number; count: number }>();
  private readonly recentRequests = new Map<string, RecentRequest<unknown>>();
  private currentUtcDay = "";
  private dailyCount = 0;
  private readonly options: {
    maxRequestsPerMinute: number;
    dailyLimit: number;
    dedupeMs?: number;
    maxRecentRequests?: number;
  };

  constructor(options: {
    maxRequestsPerMinute: number;
    dailyLimit: number;
    dedupeMs?: number;
    maxRecentRequests?: number;
  }) {
    this.options = options;
  }

  reserve<T>(
    clientId: string,
    message: string,
    analyze: () => Promise<T>,
    now = Date.now(),
  ): ProtectedRequest<T> {
    const normalizedMessage = message.trim();
    const requestHash = createHash("sha256").update(normalizedMessage).digest("hex");
    const requestKey = `${clientId}:${requestHash}`;
    const cached = this.recentRequests.get(requestKey);
    if (cached && cached.expiresAt > now) {
      return { kind: "accepted", result: cached.result as Promise<T>, deduplicated: true };
    }
    this.recentRequests.delete(requestKey);
    for (const [key, entry] of this.recentRequests) {
      if (entry.expiresAt <= now) this.recentRequests.delete(key);
    }

    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.currentUtcDay) {
      this.currentUtcDay = day;
      this.dailyCount = 0;
    }
    if (this.dailyCount >= this.options.dailyLimit) return { kind: "daily_limit" };

    const previous = this.requestsByClient.get(clientId);
    if (!previous || now - previous.startedAt >= 60_000) {
      this.requestsByClient.set(clientId, { startedAt: now, count: 1 });
    } else if (previous.count >= this.options.maxRequestsPerMinute) {
      return { kind: "minute_limit" };
    } else {
      previous.count += 1;
    }

    this.dailyCount += 1;
    const result = Promise.resolve().then(analyze);
    this.recentRequests.set(requestKey, {
      expiresAt: now + (this.options.dedupeMs ?? AI_REQUEST_DEDUPE_MS),
      result,
    });

    const maxRecentRequests = this.options.maxRecentRequests ?? 500;
    while (this.recentRequests.size > maxRecentRequests) {
      const oldestKey = this.recentRequests.keys().next().value;
      if (oldestKey === undefined) break;
      this.recentRequests.delete(oldestKey);
    }

    if (this.requestsByClient.size > 5000) {
      for (const [id, entry] of this.requestsByClient) {
        if (now - entry.startedAt >= 60_000) this.requestsByClient.delete(id);
      }
      while (this.requestsByClient.size > 5000) {
        const oldestClient = this.requestsByClient.keys().next().value;
        if (oldestClient === undefined) break;
        this.requestsByClient.delete(oldestClient);
      }
    }
    return { kind: "accepted", result, deduplicated: false };
  }
}

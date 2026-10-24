import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DAILY_AI_REQUEST_LIMIT,
  getDailyAiRequestLimit,
  SupplierAnalysisProtection,
} from "./supplier-analysis-protection.ts";

test("daily AI request limit uses a small default and accepts safe configured values", () => {
  assert.equal(getDailyAiRequestLimit(undefined), DEFAULT_DAILY_AI_REQUEST_LIMIT);
  assert.equal(getDailyAiRequestLimit("0"), 0);
  assert.equal(getDailyAiRequestLimit("75"), 75);
  assert.equal(getDailyAiRequestLimit("invalid"), DEFAULT_DAILY_AI_REQUEST_LIMIT);
  assert.equal(getDailyAiRequestLimit("1001"), DEFAULT_DAILY_AI_REQUEST_LIMIT);
});

test("per-client minute limit blocks additional distinct model calls", async () => {
  const protection = new SupplierAnalysisProtection({ maxRequestsPerMinute: 2, dailyLimit: 10 });
  const analyze = async () => "ok";
  const first = protection.reserve("client-a", "message 1", analyze, 1_000);
  assert.equal(first.kind, "accepted");
  if (first.kind !== "accepted") throw new Error("Expected accepted request.");
  await first.result;
  const second = protection.reserve("client-a", "message 2", analyze, 2_000);
  assert.equal(second.kind, "accepted");
  if (second.kind !== "accepted") throw new Error("Expected accepted request.");
  await second.result;
  assert.equal(protection.reserve("client-a", "message 3", analyze, 3_000).kind, "minute_limit");
  assert.equal(protection.reserve("client-a", "message 4", analyze, 61_001).kind, "accepted");
});

test("daily limit is shared across clients and resets on the next UTC day", async () => {
  const protection = new SupplierAnalysisProtection({ maxRequestsPerMinute: 12, dailyLimit: 2 });
  const start = Date.UTC(2026, 9, 24, 23, 59);
  const analyze = async () => "ok";
  const first = protection.reserve("client-a", "first", analyze, start);
  const second = protection.reserve("client-b", "second", analyze, start + 1);
  await Promise.all([first.result, second.result]);
  assert.equal(protection.reserve("client-c", "third", analyze, start + 2).kind, "daily_limit");
  assert.equal(protection.reserve("client-c", "next day", analyze, start + 60_000).kind, "accepted");
});

test("same client and message share one in-flight or recently completed model call", async () => {
  const protection = new SupplierAnalysisProtection({ maxRequestsPerMinute: 1, dailyLimit: 1 });
  let calls = 0;
  let finish!: (value: string) => void;
  const analyze = () => {
    calls += 1;
    return new Promise<string>((resolve) => { finish = resolve; });
  };

  const first = protection.reserve("client-a", "same message", analyze, 10_000);
  const duplicate = protection.reserve("client-a", " same message ", analyze, 10_001);
  assert.equal(first.kind, "accepted");
  assert.equal(duplicate.kind, "accepted");
  if (first.kind !== "accepted" || duplicate.kind !== "accepted") throw new Error("Expected accepted requests.");
  assert.equal(duplicate.deduplicated, true);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish("one result");
  assert.equal(await first.result, "one result");
  assert.equal(await duplicate.result, "one result");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  extractSupplierFacts,
  SupplierExtractionError,
  OPENAI_MODEL,
  OPENAI_RESPONSE_JSON_SCHEMA,
} from "./supplier-extraction.ts";

const message = "Supplier confirms 35kg flour on 26 Oct 2026";
const valid = {
  items: [{ productName: "flour", aliases: [], quantity: 35, unit: "kg", availability: "available", confirmed: true, ambiguous: false, evidence: ["35kg flour"] }],
  deliveryDates: [{ dateISO: "2026-10-26", confirmed: true, ambiguous: false, evidence: ["on 26 Oct 2026"] }],
  missingDetails: [],
};

function response(content: string, status = 200, finishReason = "stop") {
  return new Response(JSON.stringify({
    id: "test-response",
    object: "chat.completion",
    created: 1,
    model: OPENAI_MODEL,
    choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content } }],
  }), { status, headers: { "Content-Type": "application/json" } });
}

test("OpenAI JSON Schema covers the full supplier extraction structure", () => {
  const schema = OPENAI_RESPONSE_JSON_SCHEMA as any;
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["items", "deliveryDates", "missingDetails"]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.items.items.required, ["productName", "aliases", "quantity", "unit", "availability", "confirmed", "ambiguous", "evidence"]);
  assert.deepEqual(schema.properties.deliveryDates.items.required, ["dateISO", "confirmed", "ambiguous", "evidence"]);
  assert.deepEqual(schema.properties.items.items.properties.availability.enum, ["available", "unavailable", "unknown"]);
});

test("valid mocked Replit OpenAI response uses a fixed model and strict structured output", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const extraction = await extractSupplierFacts(message, {
    apiKey: "test-only-key",
    baseURL: "https://replit-ai.test/v1",
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return response(JSON.stringify(valid));
    },
  });

  assert.equal(extraction.items[0].quantity, 35);
  assert.equal(requestUrl, "https://replit-ai.test/v1/chat/completions");
  assert.equal(requestInit?.method, "POST");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer test-only-key");
  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.model, OPENAI_MODEL);
  assert.equal(body.model, "gpt-5-mini");
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema, OPENAI_RESPONSE_JSON_SCHEMA);
  assert.equal(body.max_completion_tokens, 8192);
});

test("empty content and max-token exhaustion are rejected for fallback", async () => {
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", baseURL: "https://replit-ai.test/v1", fetchImpl: async () => response(""),
  }), (error: unknown) => error instanceof SupplierExtractionError && /no structured extraction/i.test(error.message));
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", baseURL: "https://replit-ai.test/v1", fetchImpl: async () => response(JSON.stringify(valid).slice(0, 30), 200, "length"),
  }), (error: unknown) => error instanceof SupplierExtractionError && /output limit/i.test(error.message));
});

test("missing Replit integration credentials are unavailable without a request", async () => {
  let calls = 0;
  await assert.rejects(
    extractSupplierFacts(message, { apiKey: "", baseURL: "", fetchImpl: async () => { calls += 1; return response(""); } }),
    (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 503,
  );
  assert.equal(calls, 0);
});

test("network, rate-limit, and provider failures are rejected safely", async () => {
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", baseURL: "https://replit-ai.test/v1", fetchImpl: async () => { throw new TypeError("network failure with sensitive supplier text"); },
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 502 && !error.message.includes("sensitive"));
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", baseURL: "https://replit-ai.test/v1", fetchImpl: async () => response("private provider error content", 429),
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 503 && !error.message.includes("private"));
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", baseURL: "https://replit-ai.test/v1", fetchImpl: async () => response("private provider error content", 401),
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 502 && !error.message.includes("private"));
});

test("invalid JSON, invalid response JSON, schema failures, and unquoted evidence are rejected", async () => {
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", baseURL: "https://replit-ai.test/v1", fetchImpl: async () => response("{not json"),
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 502);
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", baseURL: "https://replit-ai.test/v1", fetchImpl: async () => new Response("not response JSON", { status: 200 }),
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 502);
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", baseURL: "https://replit-ai.test/v1", fetchImpl: async () => response(JSON.stringify({ ...valid, unexpected: true })),
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 502);
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", baseURL: "https://replit-ai.test/v1", fetchImpl: async () => response(JSON.stringify({
      ...valid,
      items: [{ ...valid.items[0], evidence: ["not in supplier message"] }],
    })),
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 502);
});

test("invalid supplier input and overlong messages are rejected before fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(JSON.stringify(valid)); };
  await assert.rejects(extractSupplierFacts(" ", { apiKey: "test", baseURL: "https://replit-ai.test/v1", fetchImpl }), SupplierExtractionError);
  await assert.rejects(extractSupplierFacts("x".repeat(5001), { apiKey: "test", baseURL: "https://replit-ai.test/v1", fetchImpl }), SupplierExtractionError);
  assert.equal(calls, 0);
});

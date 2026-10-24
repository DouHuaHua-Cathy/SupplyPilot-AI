import assert from "node:assert/strict";
import test from "node:test";
import {
  extractSupplierFacts,
  SupplierExtractionError,
  OPENROUTER_API_URL,
  OPENROUTER_MODEL,
  OPENROUTER_RESPONSE_JSON_SCHEMA,
} from "./supplier-extraction.ts";

const message = "Supplier confirms 35kg flour on 26 Oct 2026";
const valid = {
  items: [{ productName: "flour", aliases: [], quantity: 35, unit: "kg", availability: "available", confirmed: true, ambiguous: false, evidence: ["35kg flour"] }],
  deliveryDates: [{ dateISO: "2026-10-26", confirmed: true, ambiguous: false, evidence: ["on 26 Oct 2026"] }],
  missingDetails: [],
};

function response(content: string, status = 200, finishReason: string | null = "stop") {
  return new Response(JSON.stringify({ model: "dots-studio/dots-3-note-preview:free", choices: [{ finish_reason: finishReason, message: { content } }] }), { status, headers: { "Content-Type": "application/json" } });
}

test("OpenRouter JSON Schema uses lowercase JSON Schema types and nullable unions", () => {
  const schema = OPENROUTER_RESPONSE_JSON_SCHEMA as any;
  assert.equal(schema.type, "object");
  assert.equal(schema.properties.items.type, "array");
  assert.equal(schema.properties.items.maxItems, 12);
  assert.equal(schema.properties.items.items.properties.evidence.maxItems, 2);
  assert.deepEqual(schema.properties.items.items.properties.quantity.type, ["number", "null"]);
  assert.deepEqual(schema.properties.items.items.properties.unit.type, ["string", "null"]);
  assert.deepEqual(schema.properties.deliveryDates.items.properties.dateISO.type, ["string", "null"]);
});

test("valid mocked OpenRouter response is parsed and sends fixed free model with strict structured output", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const extraction = await extractSupplierFacts(message, {
    apiKey: "test-only-key",
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return response(JSON.stringify(valid));
    },
  });

  assert.equal(extraction.items[0].quantity, 35);
  assert.equal(requestUrl, OPENROUTER_API_URL);
  assert.equal(requestInit?.method, "POST");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer test-only-key");
  const body = JSON.parse(String(requestInit?.body));
  assert.equal(body.model, OPENROUTER_MODEL);
  assert.equal(body.model, "openrouter/free");
  assert.equal(body.provider, undefined);
  assert.equal(body.reasoning, undefined);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema, OPENROUTER_RESPONSE_JSON_SCHEMA);
  assert.equal(body.max_tokens, 2048);
});

test("empty content and max-token exhaustion are rejected for fallback", async () => {
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", fetchImpl: async () => response(""),
  }), (error: unknown) => error instanceof SupplierExtractionError && /empty structured output/i.test(error.message));
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", fetchImpl: async () => response(JSON.stringify(valid).slice(0, 30), 200, "length"),
  }), (error: unknown) => error instanceof SupplierExtractionError && /output limit/i.test(error.message));
});

test("missing OpenRouter key is reported as unavailable without making a request", async () => {
  let calls = 0;
  await assert.rejects(
    extractSupplierFacts(message, { apiKey: "", fetchImpl: async () => { calls += 1; return response(""); } }),
    (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 503,
  );
  assert.equal(calls, 0);
});

test("OpenRouter network, rate-limit, and API failures are rejected safely", async () => {
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", fetchImpl: async () => { throw new TypeError("network failure with sensitive supplier text"); },
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 502 && !error.message.includes("sensitive"));
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", fetchImpl: async () => response("private provider error content", 429),
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 503 && !error.message.includes("private"));
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", fetchImpl: async () => response("private provider error content", 401),
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 502 && !error.message.includes("private"));
});

test("invalid JSON content, invalid response JSON, schema failures, and unquoted evidence are rejected", async () => {
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", fetchImpl: async () => response("{not json"),
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 502);
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", fetchImpl: async () => new Response("not response JSON", { status: 200 }),
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 502);
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", fetchImpl: async () => response(JSON.stringify({ ...valid, unexpected: true })),
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 502);
  await assert.rejects(extractSupplierFacts(message, {
    apiKey: "test", fetchImpl: async () => response(JSON.stringify({
      ...valid,
      items: [{ ...valid.items[0], evidence: ["not in supplier message"] }],
    })),
  }), (error: unknown) => error instanceof SupplierExtractionError && error.statusCode === 502);
});

test("invalid supplier input and overlong message are rejected before fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(JSON.stringify(valid)); };
  await assert.rejects(extractSupplierFacts(" ", { apiKey: "test", fetchImpl }), SupplierExtractionError);
  await assert.rejects(extractSupplierFacts("x".repeat(5001), { apiKey: "test", fetchImpl }), SupplierExtractionError);
  assert.equal(calls, 0);
});

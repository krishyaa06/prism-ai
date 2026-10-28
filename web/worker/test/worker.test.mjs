import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.PRISM_MODEL_ENDPOINT = "https://model.example.com/v1/chat/completions";

const {
  JobCanceledError,
  ModelRequestError,
  isRetryableError,
  isRetryableStatus,
  retryDelaySeconds,
} = await import("../src/worker.mjs");

test("retries transient model statuses only", () => {
  assert.equal(isRetryableStatus(408), true);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(404), false);
});

test("uses capped exponential retry backoff", () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6].map(retryDelaySeconds), [1, 2, 4, 8, 32, 60]);
});

test("does not retry cancellation or permanent model errors", () => {
  assert.equal(isRetryableError(new JobCanceledError()), false);
  assert.equal(isRetryableError(new ModelRequestError("bad request", false)), false);
  assert.equal(isRetryableError(new ModelRequestError("temporary overload", true)), true);
});

test("retries unexpected network errors", () => {
  assert.equal(isRetryableError(new TypeError("fetch failed")), true);
});

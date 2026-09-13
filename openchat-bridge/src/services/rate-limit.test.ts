import { test } from "node:test";
import assert from "node:assert/strict";
import { allowRequest, resetRateLimits } from "./rate-limit.ts";

test("allows requests under the limit", () => {
  resetRateLimits();
  assert.equal(allowRequest("t1", 2, 1_000), true);
  assert.equal(allowRequest("t1", 2, 1_100), true);
  assert.equal(allowRequest("t1", 2, 1_200), false);
});

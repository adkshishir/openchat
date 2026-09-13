import { test } from "node:test";
import assert from "node:assert/strict";
import { decideHandoff } from "./handoff.ts";

test("replies to incoming customer messages", () => {
  const decision = decideHandoff({
    event: "message_created",
    messageType: "incoming",
    aiEnabled: true,
    tenantStatus: "active",
    content: "hello",
  });
  assert.equal(decision.action, "reply");
});

test("skips when a human is assigned", () => {
  const decision = decideHandoff({
    event: "message_created",
    messageType: "incoming",
    humanAssignee: true,
    content: "hello",
  });
  assert.equal(decision.action, "skip");
});

test("escalates on /human", () => {
  const decision = decideHandoff({
    event: "message_created",
    messageType: "incoming",
    content: "/human please",
    tenantStatus: "active",
    aiEnabled: true,
  });
  assert.equal(decision.action, "escalate");
});

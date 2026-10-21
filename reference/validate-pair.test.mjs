import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatePair, confirmationRequired } from "./validate-pair.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const site = () => [read("examples/well-known/agents.json"), read("examples/well-known/ai-instructions.json")];
const settings = () => [
  read("examples/product-examples/settings-desktop/agents.json"),
  read("examples/product-examples/settings-desktop/ai-instructions.json"),
];

test("strict profile validates coherent site and Settings pairs", () => {
  const [agents, ai] = site();
  assert.equal(validatePair(agents, ai).valid, true);
  assert.equal(validatePair(...settings()).valid, true);
});

test("strict profile rejects duplicate IDs and paths outside action_root", () => {
  const [agents, ai] = site();
  agents.endpoints[0].path = "/api/v1/status";
  const result = validatePair(agents, ai);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /outside action_root/);
  agents.endpoints[0].path = "/api/v1/agent-actions/status";
  agents.endpoints[1].name = agents.endpoints[0].name;
  assert.match(validatePair(agents, ai).errors.join(" "), /duplicate action ID/);
  agents.endpoints[1].name = "submit_task";
  for (const path of ["/api/v1/agent-actions/%2fadmin", "/api/v1/agent-actions/../admin",
    "/api/v1/agent-actions\\admin"]) {
    agents.endpoints[1].path = path;
    assert.match(validatePair(agents, ai).errors.join(" "), /outside action_root/);
  }
});

test("strict profile rejects cross-document mode and Settings anchor disagreement", () => {
  const [agents, ai] = settings();
  ai.http_action_api = "/api/actions";
  assert.match(validatePair(agents, ai).errors.join(" "), /mode disagrees/);
  ai.http_action_api = "none";
  ai.settings_actions[0].href = "app://settings?id=other";
  assert.match(validatePair(agents, ai).errors.join(" "), /documented anchor/);
});

test("false autonomy hint and named rules tighten confirmation", () => {
  const [agents, ai] = site();
  const action = agents.endpoints[0];
  ai.policy.allow_autonomous_execution = false;
  assert.equal(confirmationRequired(action, ai), true);
  ai.policy.allow_autonomous_execution = true;
  assert.equal(confirmationRequired(action, ai), false);
  ai.safety.require_human_confirmation_for = [action.name];
  assert.equal(confirmationRequired(action, ai), true);
  assert.equal(confirmationRequired(action, ai, true), true);
});

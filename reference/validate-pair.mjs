/** Optional AAA/0.2 strict pair profile for publishers and consumers.
 * The individual schemas remain additive; this profile checks relationships
 * between the two documents and declared action paths. It grants no authority.
 */
import { validateDocument } from "./validate.mjs";

const own = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function actionSurface(value) {
  if (typeof value !== "string" || value.includes("%") || value.includes("\\")) return null;
  if (value.split(/[?#]/, 1)[0].split("/").some((part) => part === "." || part === "..")) return null;
  let url;
  try { url = new URL(value, "https://aaa.invalid"); } catch { return null; }
  if (url.search || url.hash || url.username || url.password ||
      (url.protocol !== "https:" || (value.startsWith("/") && value.startsWith("//")))) return null;
  const absolute = value.startsWith("https://");
  if (!absolute && !value.startsWith("/")) return null;
  if (url.pathname.includes("//") || url.pathname.split("/").some((part) => part === "." || part === "..")) return null;
  return { origin: absolute ? url.origin : null, path: url.pathname.replace(/\/$/, "") || "/" };
}

function underRoot(root, path) {
  const a = actionSurface(root);
  const b = actionSurface(path);
  if (!a || !b) return false;
  // A validated path-only endpoint inherits an absolute root's origin.
  if (a.origin !== (b.origin ?? a.origin)) return false;
  return a.path === "/" || b.path === a.path || b.path.startsWith(`${a.path}/`);
}

/** Return {valid, errors}. This profile is opt-in for AAA/0.2 compatibility. */
export function validatePair(agents, instructions) {
  const errors = [];
  for (const [kind, document] of [["agents", agents], ["ai-instructions", instructions]]) {
    const result = validateDocument(document, kind);
    if (!result.valid) errors.push(...result.errors.map((error) => `${kind}: ${error}`));
  }
  if (errors.length) return { valid: false, errors };

  if (agents.live !== instructions.live) errors.push("documents disagree on live state");
  if (agents.status !== instructions.status) errors.push("documents disagree on status");
  if (agents.live === true && agents.status !== "active") errors.push("live documents require active status");

  const root = agents.agent_card.endpoints.action_root;
  const modes = [agents.http_action_api, instructions.http_action_api].filter((value) => value !== undefined);
  if (modes.some((value) => (value === "none") !== (root === "none"))) {
    errors.push("HTTP action mode disagrees with action_root");
  }

  const ids = new Set();
  for (const [label, actions, field] of [
    ["endpoint", agents.endpoints || [], "name"],
    ["settings action", instructions.settings_actions || [], "id"],
    ["out-of-settings action", instructions.out_of_settings_actions || [], "id"],
  ]) {
    for (const action of actions) {
      const id = action[field];
      if (ids.has(id)) errors.push(`duplicate action ID: ${id}`);
      ids.add(id);
      if (label === "endpoint" && (root === "none" || !underRoot(root, action.path))) {
        errors.push(`endpoint ${id} is outside action_root`);
      }
    }
  }
  if (root === "none") {
    const anchors = new Map();
    for (const anchor of instructions.settings_anchors || []) {
      if (anchors.has(anchor.id)) errors.push(`duplicate Settings anchor ID: ${anchor.id}`);
      anchors.set(anchor.id, anchor.deep_link);
    }
    for (const action of instructions.settings_actions || []) {
      if (!anchors.has(action.id) || anchors.get(action.id) !== action.href) {
        errors.push(`Settings action ${action.id} points outside a documented anchor`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/** A false autonomy hint can only add confirmation requirements. */
export function confirmationRequired(action, instructions, existingRequirement = false) {
  if (!own(action) || !own(instructions)) throw new TypeError("Expected an action and instructions object.");
  const rules = [
    ...(instructions.policy?.require_human_approval_for || []),
    ...(instructions.safety?.require_human_confirmation_for || []),
  ];
  return existingRequirement || instructions.policy?.allow_autonomous_execution === false ||
    rules.some((rule) => rule === action.id || rule === action.name || rule === action.path ||
      rule === action.data_agent_action);
}

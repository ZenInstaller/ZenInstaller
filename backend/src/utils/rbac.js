/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { Forbidden, InternalError } from "../error/index.js";
import { webPubSubResourceId } from "./webPubSub.js";
import { sessionTableResourceId } from "./sessionTable.js";

const ROLES = {
  "Web PubSub Service Owner": { id: "12cf5a90-567b-43ae-8102-96cf46c7d9b4", scope: webPubSubResourceId },
  "Storage Table Data Contributor": { id: "0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3", scope: sessionTableResourceId },
  "Storage Table Data Reader": { id: "76199698-9eea-4c19-bc75-cec21354c6b6", scope: sessionTableResourceId },
};

const ARM = "https://management.azure.com";

// Safe unverified: ARM rejects the token below if it is not genuine, which is the real check.
function callerObjectId(userToken) {
  try {
    const [, payload] = userToken.split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).oid ?? null;
  } catch {
    return null;
  }
}

// Every role definition the caller holds at this scope, inherited ones included.
async function grantedRoleIds(userToken, scope) {
  const oid = callerObjectId(userToken);
  if (!oid) throw InternalError({ meta: { reason: "caller_object_id_missing" } });

  const path = `${scope}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&$filter=assignedTo('${oid}')`;
  const res = await fetch(`${ARM}${path}`, { headers: { Authorization: `Bearer ${userToken}` } });
  if (!res.ok) {
    throw InternalError({ meta: { reason: "role_assignment_lookup_failed", status: res.status, scope } });
  }

  const data = await res.json();
  return (data?.value ?? []).map((a) => a.properties?.roleDefinitionId ?? "");
}

/*
 * Requirements form a tree: lists mean "all", anyOf means "one of".
 * ["A", "B", anyOf("C", allOf("D", "E"), "F")] means A and B and (C or (D and E) or F)
 */
export const anyOf = (...options) => ({ any: options });
export const allOf = (...options) => ({ all: options });

// Describes a requirement node as a human-readable string.
function describe(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node) || node.all) return `(${(node.all ?? node).map(describe).join(" and ")})`;
  return `(${node.any.map(describe).join(" or ")})`;
}

async function holdsRole(userToken, name, seen) {
  const role = ROLES[name];
  if (!role) throw InternalError({ meta: { reason: "unknown_role", role: name } });

  const scope = role.scope();
  if (!scope) throw InternalError({ meta: { reason: "resource_id_unresolved", role: name } });

  // One lookup per scope, however many places mention it.
  if (!seen.has(scope)) seen.set(scope, grantedRoleIds(userToken, scope));
  const granted = await seen.get(scope);
  return granted.some((id) => id.toLowerCase().endsWith(role.id.toLowerCase()));
}

// Returns missing requirements. A list returns only failed children, while an unsatisfied "any" returns itself.
async function missing(userToken, node, seen) {
  if (typeof node === "string") return (await holdsRole(userToken, node, seen)) ? null : node;

  const all = Array.isArray(node) ? node : node.all;
  if (all) {
    const gaps = [];
    for (const child of all) {
      const gap = await missing(userToken, child, seen);
      if (gap) gaps.push(gap);
    }
    if (!gaps.length) return null;
    return gaps.length === 1 ? gaps[0] : gaps;
  }

  for (const child of node.any) if (!(await missing(userToken, child, seen))) return null;
  return node;
}

export async function assertRoles(userToken, requirement) {
  const seen = new Map();
  const gap = await missing(userToken, requirement, seen);
  if (!gap) return;

  // Names what was actually held, since the shortfall alone says nothing about why.
  for (const [scope, granted] of seen) console.warn("Caller holds at", scope, "—", await granted);
  throw Forbidden({ meta: { reason: "insufficient_permissions", needs: describe(gap) } });
}

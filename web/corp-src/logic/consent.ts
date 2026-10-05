/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

// Whether an error message indicates missing/incremental consent (as opposed to a real failure).
export function isConsentError(msg: string): boolean {
  return msg.includes("interaction_required") || msg.includes("consent_required") || msg.includes("AADSTS65001") || msg.includes("MSA_NEEDS_TENANT");
}

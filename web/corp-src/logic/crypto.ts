/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import sodium from "libsodium-wrappers";

export async function sha256(plain: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

export function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64UrlEncode(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// The unreserved character set, so the result needs no escaping wherever it ends up.
export function generateRandomString(length = 64): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(randomValues, (v) => chars[v % chars.length]).join("");
}

export async function deterministicUuid(scope: string, roleId: string, principalId: string): Promise<string> {
  const h = toHex(await sha256(`${scope}|${roleId}|${principalId}`));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

export async function encryptSecret(publicKey: string, value: string): Promise<string> {
  await sodium.ready;
  const keyBin = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const valueBin = sodium.from_string(value);
  const encrypted = sodium.crypto_box_seal(valueBin, keyBin);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}

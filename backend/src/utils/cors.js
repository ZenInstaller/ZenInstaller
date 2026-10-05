/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { toHttpResponse } from "../error/index.js";
import { GH_TOKEN_HEADER, MS_TOKEN_HEADER } from "./auth.js";

function getAllowList() {
  return (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getAllowedOrigin(origin) {
  if (!origin) return "";

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin).origin;
  } catch {
    return "";
  }

  const allowList = getAllowList();

  if (allowList.includes(parsedOrigin)) {
    return parsedOrigin;
  }

  return "";
}

export function buildCorsResponse({ origin, status = 200, headers = {}, jsonBody, body } = {}) {
  const allowedOrigin = getAllowedOrigin(origin);

  const corsHeaders = allowedOrigin
    ? {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": `Content-Type, X-CSRF-Token, ${GH_TOKEN_HEADER}, ${MS_TOKEN_HEADER}`,
      }
    : {};
  return {
    status,
    headers: {
      ...corsHeaders,
      ...headers,
    },
    ...(jsonBody !== undefined && { jsonBody }),
    ...(body !== undefined && { body }), // Raw bytes for large files (e.g. the backend package).
  };
}

export function corsWrapper(handler) {
  return async (request, context) => {
    const origin = request.headers.get("origin");

    if (request.method === "OPTIONS") {
      return buildCorsResponse({ origin, status: 204 });
    }

    try {
      const res = await handler(request, context);
      return buildCorsResponse({ origin, ...res });
    } catch (err) {
      const errorRes = toHttpResponse(err);
      return buildCorsResponse({ origin, ...errorRes });
    }
  };
}

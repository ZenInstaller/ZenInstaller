/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

/**
 * Custom HTTP Error with status, cause, and metadata
 */
export class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message, options); // options { cause: Error, meta: any }

    this.name = this.constructor.name;
    this.status = status;
    this.meta = options.meta;

    // clean stack (remove constructor noise)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Common error helpers
 */
export const MissingParam = (options = {}) => new HttpError(400, "Missing required parameter", options);
export const Unauthorized = (options = {}) => new HttpError(401, "Unauthorized", options);
export const Forbidden = (options = {}) => new HttpError(403, "Forbidden", options);
export const NotFound = (options = {}) => new HttpError(404, "Not Found", options);
export const InternalError = (options = {}) => new HttpError(500, "Internal Server Error", options);

/**
 * Log full error chain (with cause)
 */
export function logError(error) {
  let current = error;
  let level = 0;

  while (current) {
    console.error(`[Level ${level}] ${current.name}: ${current.message}`);

    if (current.meta) {
      console.error("meta:", current.meta);
    }

    current = current.cause;
    level++;
  }

  console.error("Stack:\n", error.stack);
}

/**
 * Convert error to HTTP response (Azure Function friendly)
 */
export function toHttpResponse(error) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      jsonBody: {
        error: error.message,
        ...(error.meta && { meta: error.meta }), // ...(process.env.NODE_ENV === "development" && {meta: error.meta})
      },
    };
  }

  // Azure SDK errors carry statusCode; a 403 there means the caller's RBAC does not cover the resource.
  if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 600) {
    const forbidden = error.statusCode === 403;
    return {
      status: error.statusCode,
      jsonBody: {
        error: forbidden ? "Forbidden" : error.message,
        meta: { code: error.code, ...(forbidden && { reason: "insufficient_permissions" }) },
      },
    };
  }

  // Pass through HTTP status from upstream APIs (e.g. Octokit errors carry .status)
  if (typeof error.status === "number" && error.status >= 400 && error.status < 600) {
    return {
      status: error.status,
      jsonBody: { error: error.message },
    };
  }

  // unknown error
  logError(error);

  return {
    status: 500,
    jsonBody: {
      error: "Internal Server Error",
    },
  };
}

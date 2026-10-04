/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from "vitest";

describe("vitest smoke", () => {
  it("runs without importing project code", () => {
    expect(1 + 1).toBe(2);
  });
});

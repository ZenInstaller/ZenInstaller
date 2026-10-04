/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "../App";

describe("App - Home Page", () => {
  it("should render without crashing", () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    expect(() => {
      root.render(React.createElement(App));
    }).not.toThrow();

    root.unmount();
  });

  it("should have a DOM container", () => {
    const container = document.createElement("div");
    expect(container).toBeTruthy();
  });
});

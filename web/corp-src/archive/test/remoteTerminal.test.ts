import { describe, it, expect } from "vitest";
import { parseSocketEvent } from "../logic/remoteTerminal";
import { stageLabel } from "../config/remoteTerminal";

const SESSION = "11111111-2222-3333-4444-555555555555";

function group(data: unknown, sessionId = SESSION) {
  return JSON.stringify({ type: "message", group: sessionId, data });
}

describe("parseSocketEvent", () => {
  it("reports the Web PubSub system events the join handshake depends on", () => {
    expect(parseSocketEvent(JSON.stringify({ type: "system", event: "connected" }), SESSION)).toEqual({
      kind: "connected",
    });
    expect(parseSocketEvent(JSON.stringify({ type: "ack", ackId: 1, success: true }), SESSION)).toEqual({
      kind: "ack",
      success: true,
    });
    expect(parseSocketEvent(JSON.stringify({ type: "ack", ackId: 1, success: false }), SESSION)).toEqual({
      kind: "ack",
      success: false,
    });
  });

  it("unwraps the runner's structured messages", () => {
    expect(parseSocketEvent(group(JSON.stringify({ type: "terminal", data: "hello" })), SESSION)).toEqual({
      kind: "runner",
      message: { type: "terminal", data: "hello" },
    });
    expect(
      parseSocketEvent(
        group(JSON.stringify({ type: "deviceCode", cloud: "azure", url: "https://aka.ms/x", code: "ABC123" })),
        SESSION,
      ),
    ).toEqual({
      kind: "runner",
      message: { type: "deviceCode", cloud: "azure", url: "https://aka.ms/x", code: "ABC123" },
    });
  });

  // AWS hands the code back through the console, so its prompt carries a URL and nothing else.
  it("keeps a device code that has no code, which is how AWS arrives", () => {
    expect(
      parseSocketEvent(group(JSON.stringify({ type: "deviceCode", cloud: "aws", url: "https://signin.aws" })), SESSION),
    ).toEqual({ kind: "runner", message: { type: "deviceCode", cloud: "aws", url: "https://signin.aws" } });
  });

  it("treats a payload that is not JSON as raw terminal bytes", () => {
    const ansi = "\u001b[32mok\u001b[0m";
    expect(parseSocketEvent(group(ansi), SESSION)).toEqual({
      kind: "runner",
      message: { type: "terminal", data: ansi },
    });
  });

  // Web PubSub can echo the browser's own frames back, and keystrokes must not be printed twice.
  it("drops JSON payloads that are not runner messages", () => {
    expect(parseSocketEvent(group(JSON.stringify({ type: "input", data: "ls\r" })), SESSION)).toBeNull();
    expect(parseSocketEvent(group(JSON.stringify({ type: "resize", cols: 120, rows: 24 })), SESSION)).toBeNull();
  });

  it("ignores another session's group and unparseable frames", () => {
    expect(parseSocketEvent(group(JSON.stringify({ type: "terminal", data: "x" }), "other"), SESSION)).toBeNull();
    expect(parseSocketEvent("not json", SESSION)).toBeNull();
  });
});

describe("stageLabel", () => {
  it("names the runner's stages and passes unknown ones through", () => {
    expect(stageLabel("azure-login")).toBe("Azure Login");
    expect(stageLabel("aws-login")).toBe("AWS Login");
    expect(stageLabel("terraform-plan")).toBe("Terraform Plan");
    expect(stageLabel("something-new")).toBe("something-new");
  });
});

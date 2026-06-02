import { describe, it, expect } from "vitest";
import { deriveHealth } from "./status";

describe("deriveHealth", () => {
  it("is ok when all subsystems pass", () => {
    expect(deriveHealth({ dbOk: true, queueOk: true })).toEqual({
      status: "ok",
      checks: { db: true, queue: true },
    });
  });

  it("is degraded when exactly one subsystem fails", () => {
    expect(deriveHealth({ dbOk: true, queueOk: false }).status).toBe("degraded");
    expect(deriveHealth({ dbOk: false, queueOk: true }).status).toBe("degraded");
  });

  it("is down when all subsystems fail", () => {
    expect(deriveHealth({ dbOk: false, queueOk: false }).status).toBe("down");
  });

  it("treats the queue as ok by default", () => {
    expect(deriveHealth({ dbOk: true }).checks.queue).toBe(true);
  });
});

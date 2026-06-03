import { describe, expect, it } from "vitest";
import { uploadProblem } from "./upload-validation";

// The "reject before submit" gate (issue #24): one pure rule shared by the
// client-side submit guard and the server action, so the message a user sees in
// the browser is exactly the one the action would have produced. A file is
// described structurally ({ name, size }) so both a browser File and a server
// File satisfy it. `null` means "accepted".

describe("uploadProblem", () => {
  it("accepts a non-empty .xlsx file", () => {
    expect(uploadProblem({ name: "brief.xlsx", size: 1024 })).toBeNull();
  });

  it("rejects a missing file", () => {
    expect(uploadProblem(null)).toBe("No spreadsheet uploaded");
  });

  it("rejects an empty (zero-byte) file as no upload", () => {
    expect(uploadProblem({ name: "brief.xlsx", size: 0 })).toBe("No spreadsheet uploaded");
  });

  it("rejects a non-.xlsx file", () => {
    expect(uploadProblem({ name: "brief.csv", size: 1024 })).toBe(
      "File must be a .xlsx spreadsheet",
    );
  });

  it("accepts the extension case-insensitively", () => {
    expect(uploadProblem({ name: "BRIEF.XLSX", size: 1024 })).toBeNull();
  });
});

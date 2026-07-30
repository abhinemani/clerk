/**
 * Virus-scan port tests: the self-contained builtin catches the EICAR test
 * signature, and the gate helper fails CLOSED — an unscannable file is a
 * refused file, never a silently-admitted one.
 */
import { describe, expect, it } from "vitest";
import { assertUploadable, BuiltinScanner, type VirusScanner } from "./virusScan";

const EICAR_FILE = Buffer.from(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  "latin1",
);

describe("BuiltinScanner", () => {
  it("flags the EICAR test file and passes ordinary bytes", async () => {
    const scanner = new BuiltinScanner();
    expect(await scanner.scan(EICAR_FILE)).toEqual({
      verdict: "infected",
      signature: "Eicar-Test-Signature",
    });
    expect(await scanner.scan(Buffer.from("ordinary document text"))).toEqual({
      verdict: "clean",
    });
  });
});

describe("assertUploadable — the fail-closed gate", () => {
  it("refuses infected files with the signature named", async () => {
    const out = await assertUploadable(new BuiltinScanner(), EICAR_FILE, "eicar.com");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("Eicar-Test-Signature");
  });

  it("refuses when the scanner errors — unscanned never means clean", async () => {
    const broken: VirusScanner = {
      scan: async () => ({ verdict: "error", reason: "clamd unreachable" }),
    };
    const out = await assertUploadable(broken, Buffer.from("x"), "report.pdf");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("could not be scanned");
  });
});

/**
 * Virus scanning behind an interface (spec §4) — uploads must pass a scan
 * before bytes enter the blob store.
 *
 * Self-contained by default: the built-in scanner detects the industry-
 * standard EICAR test signature — no external service, and the refusal path
 * is real and testable end-to-end (upload eicar.com, watch it bounce).
 *
 * Production upgrade: point CLAMAV_HOST (+ optional CLAMAV_PORT, default
 * 3310) at a clamd daemon — spoken to directly over its TCP INSTREAM
 * protocol with node:net, no SDK. A clamd running in a sidecar container
 * keeps the whole stack on one machine.
 *
 * Fail-closed on errors: if the configured scanner can't be reached, the
 * upload is refused — "we couldn't scan it" never silently becomes "clean".
 */
import { connect } from "node:net";

export type ScanVerdict =
  | { verdict: "clean" }
  | { verdict: "infected"; signature: string }
  | { verdict: "error"; reason: string };

export interface VirusScanner {
  scan(bytes: Buffer, filename?: string): Promise<ScanVerdict>;
}

// The EICAR test string (safe by definition; every AV product detects it).
const EICAR =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/** Dependency-free default: catches the EICAR test signature only. */
export class BuiltinScanner implements VirusScanner {
  async scan(bytes: Buffer): Promise<ScanVerdict> {
    // EICAR must appear in the first 128 bytes per the spec; scan a bit more.
    if (bytes.subarray(0, 2048).toString("latin1").includes(EICAR)) {
      return { verdict: "infected", signature: "Eicar-Test-Signature" };
    }
    return { verdict: "clean" };
  }
}

/** clamd INSTREAM client (node:net; no SDK). */
export class ClamAvScanner implements VirusScanner {
  constructor(
    private readonly host: string,
    private readonly port = 3310,
    private readonly timeoutMs = 30_000,
  ) {}

  scan(bytes: Buffer): Promise<ScanVerdict> {
    return new Promise((resolve) => {
      const socket = connect({ host: this.host, port: this.port });
      const done = (v: ScanVerdict) => {
        socket.destroy();
        resolve(v);
      };
      socket.setTimeout(this.timeoutMs, () => done({ verdict: "error", reason: "clamd timeout" }));
      socket.on("error", (e) => done({ verdict: "error", reason: e.message }));

      let response = "";
      socket.on("data", (chunk) => {
        response += chunk.toString("utf8");
        if (!response.includes("\0") && !response.endsWith("\n")) return;
        const line = response.replace(/\0|\n/g, "").trim();
        if (/OK$/.test(line)) return done({ verdict: "clean" });
        const found = line.match(/:\s*(.+)\s+FOUND$/);
        if (found) return done({ verdict: "infected", signature: found[1]! });
        done({ verdict: "error", reason: line || "empty clamd response" });
      });

      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        // Length-prefixed chunks, then a zero-length terminator.
        const CHUNK = 64 * 1024;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          const part = bytes.subarray(i, i + CHUNK);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length);
          socket.write(len);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4)); // zero length = end of stream
      });
    });
  }
}

/** clamd when configured; the self-contained builtin otherwise. */
export function getVirusScanner(env: NodeJS.ProcessEnv = process.env): VirusScanner {
  if (env.CLAMAV_HOST) {
    return new ClamAvScanner(env.CLAMAV_HOST, env.CLAMAV_PORT ? Number(env.CLAMAV_PORT) : 3310);
  }
  return new BuiltinScanner();
}

/**
 * Gate helper: the one question upload paths ask. Fail-closed — an `error`
 * verdict refuses the file just like `infected`.
 */
export async function assertUploadable(
  scanner: VirusScanner,
  bytes: Buffer,
  filename: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const result = await scanner.scan(bytes, filename);
  if (result.verdict === "clean") return { ok: true };
  if (result.verdict === "infected") {
    return { ok: false, reason: `"${filename}" failed the virus scan (${result.signature}).` };
  }
  return { ok: false, reason: `"${filename}" could not be scanned (${result.reason}) — refused.` };
}

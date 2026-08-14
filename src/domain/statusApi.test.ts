import { describe, expect, it } from "vitest";
import { checkWebhookUrl } from "./statusApi";

describe("checkWebhookUrl", () => {
  it("accepts a plain https endpoint", () => {
    expect(checkWebhookUrl("https://newsroom.example.com/hooks/records")).toEqual({
      ok: true,
      url: "https://newsroom.example.com/hooks/records",
    });
  });

  it.each([
    ["http://newsroom.example.com/hook", "https"],
    ["not a url", "valid URL"],
    ["https://user:pass@x.example.com/h", "Credentials"],
    ["https://localhost/h", "not reachable"],
    ["https://ci.internal/h", "Internal hostnames"],
    ["https://10.0.0.8/h", "hostname, not an IP"],
    ["https://[::1]/h", "hostname, not an IP"],
    ["https://intranet/h", "fully qualified"],
  ])("rejects %s", (url, reasonFragment) => {
    const r = checkWebhookUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reasonFragment);
  });
});

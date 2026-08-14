/**
 * Status-API webhook URL validation. A tenant admin types this URL and the
 * SERVER posts to it — so this is an SSRF surface, same class as the
 * dataset_http connector: https only, a real hostname (never an IP literal,
 * localhost, or an obviously internal name). Pure; the one place the rule
 * lives for both the save action and any future re-validation.
 */
export type WebhookUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "broadcasthost"]);
const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa"];

export function checkWebhookUrl(raw: string): WebhookUrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "Enter a URL." };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "Webhook URLs must be https." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Credentials in the URL are not allowed." };
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return { ok: false, reason: "That host is not reachable from the server." };
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "Internal hostnames are not allowed." };
  }
  // IP literals (v4 or bracketed v6) — public or not, a webhook subscriber
  // should be a named host; this also closes the 10.x/169.254 class outright.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    return { ok: false, reason: "Use a hostname, not an IP address." };
  }
  if (!host.includes(".")) {
    return { ok: false, reason: "Use a fully qualified hostname." };
  }

  return { ok: true, url: url.toString() };
}

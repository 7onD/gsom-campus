export type FeedbackKind = "map" | "schedule" | "idea" | "other";

export interface FeedbackInput {
  kind: FeedbackKind;
  message: string;
  contact?: string;
  context?: Record<string, string | number | boolean | number[] | string[] | null>;
  honeypot?: string;
}

export type FeedbackResult = "ok" | "invalid" | "cooldown" | "unavailable" | "error";

export interface FeedbackDeps {
  url: string;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => number;
  app: {
    tab: string;
    deviceId: string;
    platform: string;
    browser: string;
    standalone: boolean;
    viewport: string;
    appVersion: string;
  };
}

const LAST_SENT_KEY = "vsm:fb-last";
const COOLDOWN_MS = 30_000;

export function validateFeedback(input: FeedbackInput): "ok" | "invalid" {
  if (!["map", "schedule", "idea", "other"].includes(input.kind)) return "invalid";
  const length = input.message.trim().length;
  if (length < 5 || length > 1000) return "invalid";
  if ((input.contact?.trim().length ?? 0) > 100) return "invalid";
  if (input.honeypot) return "invalid";
  return "ok";
}

export function buildPayload(input: FeedbackInput, deps: Pick<FeedbackDeps, "app" | "now">): string {
  const { app } = deps;
  return JSON.stringify({
    kind: input.kind,
    message: input.message.trim(),
    contact: input.contact?.trim() ?? "",
    context: input.context ?? null,
    hp: input.honeypot ?? "",
    app: {
      tab: app.tab,
      platform: app.platform,
      browser: app.browser,
      standalone: app.standalone,
      viewport: app.viewport,
      version: app.appVersion,
      did: app.deviceId.slice(0, 8),
    },
    ts: new Date((deps.now ?? Date.now)()).toISOString(),
  });
}

export async function sendFeedback(input: FeedbackInput, deps: FeedbackDeps): Promise<FeedbackResult> {
  if (!deps.url) return "unavailable";
  if (validateFeedback(input) === "invalid") return "invalid";

  const now = deps.now ?? Date.now;
  try {
    const last = deps.storage?.getItem(LAST_SENT_KEY);
    if (last !== null && last !== undefined && last !== "") {
      const timestamp = Number(last);
      if (Number.isFinite(timestamp) && now() - timestamp < COOLDOWN_MS && now() >= timestamp) {
        return "cooldown";
      }
    }
  } catch {
    // Отзыв можно отправить и без доступного хранилища.
  }

  try {
    const response = await (deps.fetchImpl ?? fetch)(deps.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      credentials: "omit",
      body: buildPayload(input, deps),
    });
    if (!response.ok) return "error";
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null || !("ok" in data) || data.ok !== true) {
      return "error";
    }
    try {
      deps.storage?.setItem(LAST_SENT_KEY, String(now()));
    } catch {
      // Успешная отправка не зависит от доступности хранилища.
    }
    return "ok";
  } catch {
    return "error";
  }
}

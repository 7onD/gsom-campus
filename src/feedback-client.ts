export type FeedbackKind = "map" | "schedule" | "idea" | "other";

export interface FeedbackInput {
  kind: FeedbackKind;
  message: string;
  contact?: string;
  context?: Record<string, string | number | boolean | number[] | string[] | null>;
  honeypot?: string;
}

/** Причины сбоя отправки: по ним же строится событие feedback_error. */
export type FeedbackFailure = "timeout" | "network" | "limit" | "server";
export type FeedbackResult = "ok" | "invalid" | "cooldown" | "unavailable" | FeedbackFailure;

export const FEEDBACK_TIMEOUT_MS = 15_000;

export interface FeedbackDeps {
  url: string;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => number;
  timeoutMs?: number;
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

  // Таймаут накрывает и ожидание ответа, и чтение тела: форма не должна висеть на «Отправляем…».
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout");
      controller.abort();
    }, deps.timeoutMs ?? FEEDBACK_TIMEOUT_MS);
  });
  const attempt = async (): Promise<FeedbackResult> => {
    let response: Response;
    try {
      response = await (deps.fetchImpl ?? fetch)(deps.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        credentials: "omit",
        body: buildPayload(input, deps),
        signal: controller.signal,
      });
    } catch {
      return "network";
    }
    if (response.status === 429) return "limit";
    if (!response.ok) return "server";
    try {
      const data: unknown = await response.json();
      if (typeof data !== "object" || data === null || !("ok" in data) || data.ok !== true) return "server";
    } catch {
      return "server";
    }
    try {
      deps.storage?.setItem(LAST_SENT_KEY, String(now()));
    } catch {
      // Успешная отправка не зависит от доступности хранилища.
    }
    return "ok";
  };
  try {
    return await Promise.race([attempt(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const DRAFT_KEY = "vsm:fb-draft";

export interface FeedbackDraft {
  kind: FeedbackKind;
  message: string;
  contact: string;
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Черновик лежит только на устройстве, чтобы неотправленный текст не пропал. */
export function saveDraft(storage: DraftStorage | null, draft: FeedbackDraft): void {
  try {
    if (!draft.message.trim()) storage?.removeItem(DRAFT_KEY);
    else storage?.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Без хранилища текст остаётся только в открытой форме.
  }
}

export function loadDraft(storage: DraftStorage | null): FeedbackDraft | null {
  try {
    const data = JSON.parse(storage?.getItem(DRAFT_KEY) ?? "null") as Partial<FeedbackDraft> | null;
    if (!data || typeof data.message !== "string" || typeof data.contact !== "string") return null;
    if (!["map", "schedule", "idea", "other"].includes(data.kind ?? "")) return null;
    return data as FeedbackDraft;
  } catch {
    return null;
  }
}

export function clearDraft(storage: DraftStorage | null): void {
  try {
    storage?.removeItem(DRAFT_KEY);
  } catch {
    // Нечего очищать.
  }
}

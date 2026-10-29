import { FEEDBACK_URL } from "./config.ts";
import { sendFeedback, type FeedbackInput, type FeedbackKind } from "./feedback-client.ts";
import { icon } from "./icons.ts";
import { getState } from "./store.ts";
import { getCommonContext, getDeviceId, track } from "./telemetry.ts";
import "./feedback.css";

export type FeedbackOpenOptions = {
  kind?: FeedbackKind;
  title?: string;
  prefill?: string;
  context?: FeedbackInput["context"];
};

let activeSheet: { close: (restoreFocus: boolean) => void; returnFocus: HTMLElement | null } | null = null;
let nextTitleId = 0;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconNode(name: "close" | "send" | "check", size: number): HTMLSpanElement {
  const node = element("span", "feedback-icon");
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = icon(name, { size });
  return node;
}

export function openFeedback(opts: FeedbackOpenOptions = {}): void {
  const returnFocus = activeSheet?.returnFocus
    ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  activeSheet?.close(false);

  const dialog = element("dialog", "feedback-sheet");
  const titleId = `feedback-title-${++nextTitleId}`;
  dialog.setAttribute("aria-labelledby", titleId);

  let closed = false;
  function cleanup(restoreFocus: boolean): void {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (activeSheet?.close === close) activeSheet = null;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  }
  function close(restoreFocus: boolean): void {
    cleanup(restoreFocus);
  }
  activeSheet = { close, returnFocus };

  dialog.addEventListener("close", () => cleanup(true));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close(true);
  });

  const panel = element("div", "feedback-panel");
  const grabber = element("div", "feedback-grabber");
  grabber.setAttribute("aria-hidden", "true");
  panel.append(grabber);

  const heading = element("div", "feedback-heading");
  const title = element("h2", "feedback-title", opts.title ?? "Связаться с разработчиками");
  title.id = titleId;
  const closeButton = element("button", "feedback-close");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Закрыть");
  closeButton.append(iconNode("close", 22));
  closeButton.addEventListener("click", () => close(true));
  heading.append(title, closeButton);
  panel.append(heading, element(
    "p",
    "feedback-description",
    "Расскажите, что не так или что улучшить. Мы читаем все сообщения.",
  ));

  const form = element("form", "feedback-form");
  form.noValidate = true;
  const kinds: { kind: FeedbackKind; label: string }[] = [
    { kind: "map", label: "Ошибка на карте" },
    { kind: "schedule", label: "Неверное расписание" },
    { kind: "idea", label: "Идея" },
    { kind: "other", label: "Другое" },
  ];
  let selectedKind: FeedbackKind = kinds.some(({ kind }) => kind === opts.kind) ? opts.kind! : "other";
  const group = element("div", "feedback-kinds");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Тип сообщения");
  const chips = kinds.map(({ kind, label }) => {
    const chip = element("button", "feedback-chip", label);
    chip.type = "button";
    chip.setAttribute("role", "radio");
    chip.addEventListener("click", () => selectKind(kind));
    group.append(chip);
    return chip;
  });
  function selectKind(kind: FeedbackKind): void {
    selectedKind = kind;
    chips.forEach((chip, index) => {
      const selected = kinds[index].kind === kind;
      chip.setAttribute("aria-checked", String(selected));
      chip.tabIndex = selected ? 0 : -1;
    });
  }
  group.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const current = kinds.findIndex(({ kind }) => kind === selectedKind);
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = (current + direction + kinds.length) % kinds.length;
    selectKind(kinds[next].kind);
    chips[next].focus();
  });
  selectKind(selectedKind);
  form.append(group);

  const messageLabel = element("label", "feedback-label", "Сообщение");
  const textarea = element("textarea", "feedback-textarea");
  textarea.name = "message";
  textarea.rows = 5;
  textarea.maxLength = 1000;
  textarea.placeholder = "Что случилось или что улучшить?";
  textarea.value = opts.prefill ?? "";
  messageLabel.append(textarea);
  form.append(messageLabel);

  const counter = element("div", "feedback-counter");
  form.append(counter);

  const contactLabel = element("label", "feedback-label", "Контакт для ответа (необязательно)");
  const contact = element("input", "feedback-input");
  contact.type = "text";
  contact.name = "contact";
  contact.maxLength = 100;
  contact.placeholder = "Telegram @ник или почта — если хотите ответ";
  contact.autocomplete = "off";
  contactLabel.append(contact);
  form.append(contactLabel);

  const honeypot = element("input", "feedback-honeypot");
  honeypot.type = "text";
  honeypot.name = "website";
  honeypot.tabIndex = -1;
  honeypot.autocomplete = "off";
  honeypot.setAttribute("aria-hidden", "true");
  form.append(honeypot);

  if (opts.context && ["from", "to", "floors", "steps"].some((key) => key in opts.context!)) {
    form.append(element("p", "feedback-context", "К сообщению приложим данные маршрута"));
  }

  const status = element("p", "feedback-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  form.append(status);

  const submit = element("button", "feedback-submit");
  submit.type = "submit";
  const submitIcon = iconNode("send", 18);
  const submitText = element("span", undefined, "Отправить");
  submit.append(submitIcon, submitText);
  form.append(submit);
  panel.append(form);
  dialog.append(panel);
  document.body.append(dialog);

  let sending = false;
  let retry = false;
  function update(): void {
    counter.textContent = `${textarea.value.length}/1000`;
    submit.disabled = sending || textarea.value.trim().length < 5;
    if (!sending) submitText.textContent = retry ? "Повторить" : "Отправить";
  }
  textarea.addEventListener("input", () => {
    textarea.classList.remove("is-invalid");
    textarea.removeAttribute("aria-invalid");
    status.textContent = "";
    update();
  });
  update();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    sending = true;
    submit.disabled = true;
    submitText.textContent = "Отправляем…";
    status.textContent = "";

    let storage: Storage | null = null;
    try {
      storage = localStorage;
    } catch {
      // Отправка доступна без локального хранилища.
    }

    const context = getCommonContext();
    const kind = selectedKind;
    const result = await sendFeedback({
      kind,
      message: textarea.value,
      contact: contact.value,
      context: opts.context,
      honeypot: honeypot.value,
    }, {
      url: FEEDBACK_URL,
      storage,
      app: {
        tab: getState().tab,
        deviceId: getDeviceId(),
        ...context,
      },
    });

    if (closed) return;
    sending = false;
    if (result === "ok") {
      track("feedback_sent", { kind });
      const success = element("div", "feedback-success");
      const badge = element("div", "feedback-success-icon");
      badge.append(iconNode("check", 28));
      const message = element("p", undefined, "Спасибо! Сообщение получено.");
      const done = element("button", "feedback-submit", "Закрыть");
      done.type = "button";
      done.addEventListener("click", () => close(true));
      success.append(badge, message, done);
      panel.replaceChildren(grabber, heading, success);
      done.focus();
      return;
    }

    if (result === "invalid") {
      textarea.classList.add("is-invalid");
      textarea.setAttribute("aria-invalid", "true");
      status.textContent = "Напишите не менее 5 символов. Проверьте сообщение и попробуйте ещё раз.";
      textarea.focus();
    } else if (result === "cooldown") {
      status.textContent = "Подождите немного перед следующим сообщением";
    } else {
      status.textContent = "Не удалось отправить. Проверьте сеть и попробуйте ещё раз";
      retry = true;
    }
    update();
  });

  dialog.showModal();
  textarea.focus();
}

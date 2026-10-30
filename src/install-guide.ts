import { icon } from "./icons.ts";
import {
  currentInstallEnv,
  INSTALL_METHODS,
  markInstallGuideSeen,
  pickInstallMethod,
  type InstallMethod,
} from "./install-env.ts";
import "./install-guide.css";

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

export function openInstallGuide(_opts: { auto?: boolean } = {}): void {
  const returnFocus = activeSheet?.returnFocus
    ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  activeSheet?.close(false);

  const env = currentInstallEnv();
  const recommended = pickInstallMethod(env);
  const dialog = element("dialog", "install-sheet");
  const titleId = `install-title-${++nextTitleId}`;
  const descriptionId = `install-description-${nextTitleId}`;
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.setAttribute("aria-describedby", descriptionId);

  let closed = false;
  function close(restoreFocus: boolean): void {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    dialog.remove();
    if (activeSheet?.close === close) activeSheet = null;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  }
  activeSheet = { close, returnFocus };

  dialog.addEventListener("close", () => close(true));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close(true);
  });

  const panel = element("div", "install-panel");
  const grabber = element("div", "install-grabber");
  grabber.setAttribute("aria-hidden", "true");
  panel.append(grabber);

  const heading = element("div", "install-heading");
  const title = element("h2", "install-title", "Как добавить на рабочий стол");
  title.id = titleId;
  const closeButton = element("button", "install-close");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Закрыть");
  closeButton.innerHTML = icon("close", { size: 22 });
  closeButton.addEventListener("click", () => close(true));
  heading.append(title, closeButton);
  panel.append(heading);

  const description = element(
    "p",
    "install-description",
    "Ярлык откроет ВШМ.Кампус как приложение — без адресной строки и одним нажатием.",
  );
  description.id = descriptionId;
  panel.append(description);

  panel.append(element("p", "install-label", "Ваш браузер"));
  const picker = element("div", "install-chips");
  picker.setAttribute("role", "radiogroup");
  picker.setAttribute("aria-label", "Браузер");
  const chips = INSTALL_METHODS.map((method) => {
    const chip = element("button", "install-chip", method.label);
    chip.type = "button";
    chip.setAttribute("role", "radio");
    picker.append(chip);
    return chip;
  });
  panel.append(picker);

  const instructions = element("div", "install-instructions");
  instructions.setAttribute("aria-live", "polite");
  function select(method: InstallMethod): void {
    chips.forEach((chip, index) => {
      const on = INSTALL_METHODS[index] === method;
      chip.setAttribute("aria-checked", String(on));
    });
    const steps = element("ol", "install-steps");
    for (const step of method.steps) steps.append(element("li", undefined, step));
    const children: HTMLElement[] = [steps];
    if (method.note) children.push(element("p", "install-note", method.note));
    instructions.replaceChildren(...children);
  }
  chips.forEach((chip, index) => {
    chip.addEventListener("click", () => {
      const method = INSTALL_METHODS[index];
      if (method) select(method);
    });
  });
  select(recommended);
  panel.append(instructions);

  const done = element("button", "install-done", "Понятно");
  done.type = "button";
  done.addEventListener("click", () => close(true));
  panel.append(done);

  dialog.append(panel);
  document.body.append(dialog);
  dialog.showModal();
  markInstallGuideSeen();
  done.focus();
}

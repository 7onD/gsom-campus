import "./settings-view.css";
import { icon } from "../icons.ts";
import { openFeedback } from "../feedback.ts";
import { track } from "../telemetry.ts";
import {
  getState,
  now,
  optionalCourses,
  reload,
  resetElectives,
  setElective,
  setGroup,
  subscribe,
} from "../store.ts";
import type { OptionalCourse } from "../timetable.ts";

export interface GroupsSnapshot {
  fetched: string;
  programs: {
    program: string;
    admission: number;
    programId: number;
    groups: { id: number; name: string }[];
  }[];
}

type Program = GroupsSnapshot["programs"][number];
type Group = Program["groups"][number];

const shortPrograms: Record<string, string> = {
  "Менеджмент": "Менеджмент",
  "Менеджмент (бизнес-аналитик)": "Менеджмент (БА)",
  "Международный менеджмент": "Междунар. менеджмент",
  "Международный менеджмент (с изучением языков)": "Междунар. менеджмент + языки",
  "Государственное и муниципальное управление": "ГМУ",
};

let nextWizardId = 0;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string): HTMLButtonElement {
  const node = element("button", className, text);
  node.type = "button";
  return node;
}

function courseOf(program: Program): number {
  const date = now();
  const startYear = date.getFullYear() - (date.getMonth() < 8 ? 1 : 0);
  return startYear - program.admission + 1;
}

function groupLabel(name: string): string {
  return name.replace(/^\d{2,4}\./, "").replace(/-вшм$/i, "");
}

function plural(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "занятий";
  const last = n % 10;
  if (last === 1) return "занятие";
  if (last >= 2 && last <= 4) return "занятия";
  return "занятий";
}

function soleEducator(educators: string[]): string | null {
  if (educators.length !== 1) return null;
  const name = educators[0]?.trim();
  if (!name) return null;
  const full = /^(\S+)\s+(\S+)\s+(\S+)$/.exec(name);
  return full ? `${full[1]} ${full[2]?.[0]}. ${full[3]?.[0]}.` : name;
}

export function mountSettingsView(
  root: HTMLElement,
  deps: { groups: GroupsSnapshot },
): { destroy(): void } {
  const view = element("div", "settings-view");
  const header = element("header", "settings-view__header");
  header.append(
    element("div", "settings-view__brand", "ВШМ.Кампус"),
    element("h1", "settings-view__title", "Настройки"),
  );

  const groupSection = element("section", "settings-view__card");
  groupSection.setAttribute("aria-label", "Моя группа");
  groupSection.append(element("h2", "settings-view__section-title", "Моя группа"));
  const groupRow = element("div", "settings-view__group-row");
  const wizardId = `settings-group-wizard-${++nextWizardId}`;
  const wizardOuter = element("div", "settings-view__wizard-outer");
  wizardOuter.id = wizardId;
  const wizardInner = element("div", "settings-view__wizard-inner");
  wizardOuter.append(wizardInner);
  groupSection.append(groupRow, wizardOuter);

  const groupNote = element(
    "p",
    "settings-view__note",
    "Расписание: timetable.spbu.ru. Группа хранится только на этом устройстве.",
  );

  const optionalSection = element("section", "settings-view__card settings-view__optionals");
  optionalSection.setAttribute("aria-label", "Факультативы и элективы");
  const optionalHeader = element("div", "settings-view__section-header");
  const optionalCount = element("span", "settings-view__count");
  optionalHeader.append(
    element("h2", "settings-view__section-title", "Факультативы и элективы"),
    optionalCount,
  );
  const optionalHint = element(
    "p",
    "settings-view__hint",
    "В расписании показываются только отмеченные. Остальные скрыты.",
  );
  const optionalBody = element("div", "settings-view__optional-body");
  const reset = button("settings-view__text-button", "Сбросить выбор");
  reset.addEventListener("click", resetElectives);
  optionalSection.append(optionalHeader, optionalHint, optionalBody, reset);

  const aboutSection = element("section", "settings-view__card settings-view__about");
  aboutSection.append(element("h2", "settings-view__section-title", "О приложении и связь"));
  const aboutRows = element("div", "settings-view__about-rows");
  aboutSection.append(aboutRows);

  const footer = element("footer", "settings-view__footer", "ВШМ.Кампус · версия 0.1");
  view.append(header, groupSection, groupNote, optionalSection, aboutSection, footer);
  root.append(view);

  let destroyed = false;
  let editing = getState().groupId === null;
  let wizardCourse: number | null = null;
  let wizardProgram: Program | null = null;
  let wizardGroupId: number | null = null;
  let renderedLessons: ReturnType<typeof getState>["lessons"] | undefined;
  let renderedGroupId: number | null | undefined;
  let renderedError: boolean | undefined;
  let sheet: HTMLDialogElement | null = null;

  function selection(): { program: Program; group: Group } | null {
    const id = getState().groupId;
    if (id === null) return null;
    for (const program of deps.groups.programs) {
      const group = program.groups.find((item) => item.id === id);
      if (group) return { program, group };
    }
    return null;
  }

  function openSheet(title: string, buildBody: (body: HTMLElement) => void): void {
    if (sheet) sheet.close();

    const dialog = element("dialog", "settings-view__sheet");
    const content = element("div", "settings-view__sheet-content");
    const grabber = element("div", "settings-view__grabber");
    grabber.setAttribute("aria-hidden", "true");
    const heading = element("h2", "settings-view__sheet-title", title);
    const body = element("div", "settings-view__sheet-body");
    buildBody(body);
    const close = button("settings-view__sheet-close", "Закрыть");
    close.addEventListener("click", () => dialog.close());
    content.append(grabber, heading, body, close);
    dialog.append(content);

    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom
      ) {
        dialog.close();
      }
    });
    dialog.addEventListener("close", () => {
      if (sheet === dialog) sheet = null;
      dialog.remove();
    });

    document.body.append(dialog);
    sheet = dialog;
    dialog.showModal();
  }

  function aboutRow(
    label: string,
    iconName: "send" | "help" | "info",
    action: () => void,
  ): void {
    const row = button("settings-view__about-row", "");
    row.textContent = "";
    const symbol = element("span", "settings-view__icon");
    symbol.innerHTML = icon(iconName, { size: 20 });
    const text = element("span", "settings-view__about-label", label);
    const arrow = element("span", "settings-view__arrow");
    arrow.setAttribute("aria-hidden", "true");
    arrow.innerHTML = icon("chevronRight", { size: 19 });
    row.append(symbol, text, arrow);
    row.addEventListener("click", action);
    aboutRows.append(row);
  }

  aboutRow("Связаться с разработчиками", "send", () => openFeedback());

  aboutRow("Как пользоваться", "help", () => {
    openSheet("Как пользоваться", (body) => {
      const list = element("ol", "settings-view__help-list");
      for (const text of [
        "Откройте «Расписание» и нажмите на пару, чтобы увидеть её аудиторию на карте.",
        "На «Карте» введите номер аудитории или нажмите на неё на плане.",
        "Выберите, откуда идёте: вход, холл, кафе, конференц-зал или деканат.",
        "Этажи переключаются кнопками 1 и 2; между этажами маршрут идёт по лестнице.",
        "Карту можно приближать двумя пальцами.",
      ]) {
        list.append(element("li", "settings-view__help-item", text));
      }
      body.append(list);
    });
  });

  aboutRow("О приложении", "info", () => {
    openSheet("О приложении", (body) => {
      body.append(
        element("p", "settings-view__sheet-lead", "ВШМ.Кампус · версия 0.1"),
        element(
          "p",
          "settings-view__sheet-text",
          "Навигатор по главному корпусу ВШМ СПбГУ: расписание и маршрут до аудитории.",
        ),
        element(
          "p",
          "settings-view__sheet-text",
          "Данные расписания: timetable.spbu.ru. Настройки хранятся только на вашем устройстве.",
        ),
      );
    });
  });

  function finishSelection(group: Group): void {
    wizardGroupId = group.id;
    editing = false;
    setGroup(group.id);
    track("group_selected", {
      course: wizardProgram ? courseOf(wizardProgram) : null,
      program: wizardProgram?.program ?? null,
      admission: wizardProgram?.admission ?? null,
    });
    render();
  }

  function selectProgram(program: Program): void {
    wizardProgram = program;
    wizardGroupId = null;
    if (program.groups.length === 1) {
      finishSelection(program.groups[0]!);
    } else {
      render();
    }
  }

  function selectCourse(course: number): void {
    wizardCourse = course;
    wizardProgram = null;
    wizardGroupId = null;
    const programs = deps.groups.programs.filter((program) => courseOf(program) === course);
    if (programs.length === 1) {
      selectProgram(programs[0]!);
    } else {
      render();
    }
  }

  function chipSection(
    title: string,
    items: { label: string; fullLabel?: string; checked: boolean; choose: () => void }[],
  ): HTMLElement {
    const section = element("section", "settings-view__step");
    section.append(element("h3", "settings-view__step-title", title));
    const chips = element("div", "settings-view__chips");
    chips.setAttribute("role", "radiogroup");
    chips.setAttribute("aria-label", title);
    for (const item of items) {
      const chip = button("settings-view__chip", item.label);
      chip.setAttribute("role", "radio");
      chip.setAttribute("aria-checked", String(item.checked));
      if (item.fullLabel) chip.setAttribute("aria-label", item.fullLabel);
      chip.addEventListener("click", item.choose);
      chips.append(chip);
    }
    section.append(chips);
    return section;
  }

  function renderWizard(): void {
    const content = element("div", "settings-view__wizard");
    const heading = element("div", "settings-view__wizard-heading");
    heading.append(element("h3", "settings-view__wizard-title", "Выберите группу"));
    if (selection()) {
      const cancel = button("settings-view__text-button", "Отмена");
      cancel.addEventListener("click", () => {
        editing = false;
        render();
      });
      heading.append(cancel);
    }
    content.append(heading);

    const courses = [...new Set(
      deps.groups.programs.map(courseOf).filter((course) => course >= 1 && course <= 6),
    )].sort((a, b) => a - b);

    content.append(chipSection("КУРС", courses.map((course) => ({
      label: `${course} курс`,
      checked: wizardCourse === course,
      choose: () => selectCourse(course),
    }))));

    if (wizardCourse !== null) {
      const programs = deps.groups.programs.filter(
        (program) => courseOf(program) === wizardCourse,
      );
      content.append(chipSection("ПРОГРАММА", programs.map((program) => ({
        label: shortPrograms[program.program] ?? program.program,
        fullLabel: program.program,
        checked: wizardProgram === program,
        choose: () => selectProgram(program),
      }))));
    }

    if (wizardProgram) {
      content.append(chipSection("ГРУППА", wizardProgram.groups.map((group) => ({
        label: groupLabel(group.name),
        fullLabel: group.name,
        checked: wizardGroupId === group.id,
        choose: () => finishSelection(group),
      }))));
    }

    wizardInner.replaceChildren(content);
  }

  function renderGroup(): void {
    const current = selection();
    const symbol = element("span", "settings-view__icon settings-view__icon--group");
    symbol.innerHTML = icon("cap", { size: 22 });
    const description = element("div", "settings-view__group-description");

    if (current) {
      description.append(
        element(
          "div",
          "settings-view__group-name",
          `${shortPrograms[current.program.program] ?? current.program.program} · ${groupLabel(current.group.name)}`,
        ),
        element("div", "settings-view__group-detail", `${courseOf(current.program)} курс · набор ${current.program.admission}`),
      );
    } else {
      description.append(element("div", "settings-view__group-name", "Группа не выбрана"));
    }

    groupRow.replaceChildren(symbol, description);
    if (current) {
      const change = button("settings-view__change", "Изменить");
      change.setAttribute("aria-controls", wizardId);
      change.setAttribute("aria-expanded", String(editing));
      change.addEventListener("click", () => {
        if (editing) {
          editing = false;
        } else {
          editing = true;
          wizardCourse = courseOf(current.program);
          wizardProgram = current.program;
          wizardGroupId = current.group.id;
        }
        render();
      });
      groupRow.append(change);
    }

    const open = editing || !current;
    wizardOuter.classList.toggle("settings-view__wizard-outer--open", open);
    wizardOuter.inert = !open;
    wizardOuter.setAttribute("aria-hidden", String(!open));
  }

  function optionalRow(course: OptionalCourse): HTMLLabelElement {
    const row = element("label", "settings-view__optional-row");
    const description = element("span", "settings-view__optional-description");
    const details = element(
      "span",
      "settings-view__optional-detail",
      `${course.count} ${plural(course.count)}`,
    );
    const educator = soleEducator(course.educators);
    if (educator) details.append(document.createTextNode(` · ${educator}`));
    description.append(
      element("span", "settings-view__optional-name", course.name),
      details,
    );

    const toggle = element("input", "settings-view__switch");
    toggle.type = "checkbox";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-label", course.name);
    toggle.dataset.key = course.key;
    toggle.checked = getState().selected.includes(course.key);
    toggle.addEventListener("change", () => setElective(course.key, toggle.checked));
    row.append(description, toggle);
    return row;
  }

  function renderOptionalBody(): void {
    const state = getState();
    if (state.lessons === null) {
      if (state.error) {
        const message = element(
          "p",
          "settings-view__empty",
          "Не удалось загрузить список.",
        );
        const retry = button("settings-view__text-button settings-view__retry", "Повторить");
        retry.addEventListener("click", reload);
        optionalBody.replaceChildren(message, retry);
      } else {
        const skeleton = element("div", "settings-view__skeleton-list");
        skeleton.setAttribute("role", "status");
        skeleton.setAttribute("aria-label", "Загрузка факультативов и элективов");
        for (let i = 0; i < 4; i++) {
          const line = element("div", "settings-view__skeleton-row");
          line.setAttribute("aria-hidden", "true");
          skeleton.append(line);
        }
        optionalBody.replaceChildren(skeleton);
      }
      return;
    }

    const content = element("div", "settings-view__optional-groups");
    const courses = optionalCourses();
    if (!courses.length) {
      content.append(element("p", "settings-view__empty", "Факультативов и элективов пока нет."));
    }
    for (const kind of ["Факультатив", "Электив"] as const) {
      const entries = courses.filter((course) => course.kind === kind);
      if (!entries.length) continue;
      const subsection = element("section", "settings-view__optional-group");
      subsection.append(element(
        "h3",
        "settings-view__optional-heading",
        kind === "Факультатив" ? "Факультативы" : "Элективы",
      ));
      for (const course of entries) subsection.append(optionalRow(course));
      content.append(subsection);
    }
    if (state.error) {
      const retry = button("settings-view__text-button settings-view__retry", "Не удалось обновить список · Повторить");
      retry.addEventListener("click", reload);
      content.prepend(retry);
    }
    optionalBody.replaceChildren(content);
  }

  function render(): void {
    if (destroyed) return;
    const state = getState();
    renderGroup();
    if (editing || !selection()) renderWizard();

    optionalSection.hidden = state.groupId === null;
    if (state.groupId === null) return;

    if (
      renderedLessons !== state.lessons ||
      renderedGroupId !== state.groupId ||
      renderedError !== state.error
    ) {
      renderOptionalBody();
      renderedLessons = state.lessons;
      renderedGroupId = state.groupId;
      renderedError = state.error;
    }

    const courses = state.lessons ? optionalCourses() : [];
    const selected = new Set(state.selected);
    const count = courses.filter((course) => selected.has(course.key)).length;
    optionalCount.textContent = `выбрано ${count} из ${courses.length}`;
    reset.disabled = state.selected.length === 0;
    for (const input of optionalBody.querySelectorAll<HTMLInputElement>(".settings-view__switch")) {
      input.checked = selected.has(input.dataset.key ?? "");
    }
  }

  const unsubscribe = subscribe(render);
  render();

  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      if (sheet) sheet.close();
      view.remove();
    },
  };
}

export type InstallPlatform = "ios" | "android" | "desktop";
export type InstallBrowser =
  | "safari"
  | "chrome"
  | "firefox"
  | "edge"
  | "samsung"
  | "yandex"
  | "opera"
  | "other";

export interface InstallEnv {
  platform: InstallPlatform;
  browser: InstallBrowser;
  standalone: boolean;
}

export function detectInstallEnv(input: {
  userAgent: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  displayModeStandalone?: boolean;
}): InstallEnv {
  const ua = input.userAgent;
  const standalone = Boolean(input.standalone) || Boolean(input.displayModeStandalone);

  if (/iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && (input.maxTouchPoints ?? 0) > 1)) {
    let browser: InstallBrowser = "safari";
    if (ua.includes("CriOS")) browser = "chrome";
    else if (ua.includes("FxiOS")) browser = "firefox";
    else if (ua.includes("EdgiOS")) browser = "edge";
    else if (ua.includes("OPT/")) browser = "opera";
    else if (ua.includes("YaBrowser")) browser = "yandex";
    return { platform: "ios", browser, standalone };
  }

  if (ua.includes("Android")) {
    let browser: InstallBrowser = "other";
    if (ua.includes("SamsungBrowser")) browser = "samsung";
    else if (ua.includes("YaBrowser")) browser = "yandex";
    else if (ua.includes("EdgA")) browser = "edge";
    else if (ua.includes("OPR/")) browser = "opera";
    else if (ua.includes("Firefox")) browser = "firefox";
    else if (ua.includes("Chrome")) browser = "chrome";
    return { platform: "android", browser, standalone };
  }

  let browser: InstallBrowser = "other";
  if (ua.includes("Edg/")) browser = "edge";
  else if (ua.includes("OPR/")) browser = "opera";
  else if (ua.includes("YaBrowser")) browser = "yandex";
  else if (ua.includes("Firefox")) browser = "firefox";
  else if (ua.includes("Chrome")) browser = "chrome";
  else if (ua.includes("Safari")) browser = "safari";
  return { platform: "desktop", browser, standalone };
}

export interface InstallMethod {
  id: string;
  label: string;
  platform: InstallPlatform;
  browser: InstallBrowser;
  steps: string[];
  note?: string;
}

export const INSTALL_METHODS: InstallMethod[] = [
  {
    id: "ios-safari",
    label: "Safari · iPhone и iPad",
    platform: "ios",
    browser: "safari",
    steps: [
      "Откройте сайт в Safari.",
      "Нажмите кнопку «Поделиться» (квадрат со стрелкой вверх) внизу экрана.",
      "Прокрутите меню вниз и выберите «На экран “Домой”».",
      "Нажмите «Добавить» в правом верхнем углу.",
    ],
  },
  {
    id: "ios-chrome",
    label: "Chrome и другие браузеры · iPhone",
    platform: "ios",
    browser: "chrome",
    steps: [
      "Нажмите «Поделиться» в адресной строке или в меню браузера.",
      "Выберите «Добавить на главный экран» («На экран “Домой”»).",
      "Подтвердите кнопкой «Добавить».",
    ],
    note: "Если такого пункта нет, откройте сайт в Safari и следуйте инструкции для Safari: на iPhone ярлык надёжнее всего создаётся там.",
  },
  {
    id: "android-chrome",
    label: "Chrome · Android",
    platform: "android",
    browser: "chrome",
    steps: [
      "Нажмите меню ⋮ в правом верхнем углу.",
      "Выберите «Установить приложение» или «Добавить на главный экран».",
      "Подтвердите кнопкой «Установить» или «Добавить».",
    ],
  },
  {
    id: "android-samsung",
    label: "Samsung Internet",
    platform: "android",
    browser: "samsung",
    steps: [
      "Нажмите меню ≡ внизу экрана.",
      "Выберите «Добавить страницу на» и затем «Главный экран».",
      "Подтвердите кнопкой «Добавить».",
    ],
  },
  {
    id: "android-firefox",
    label: "Firefox · Android",
    platform: "android",
    browser: "firefox",
    steps: [
      "Нажмите меню ⋮.",
      "Выберите «Установить».",
      "Подтвердите добавление на главный экран.",
    ],
  },
  {
    id: "android-other",
    label: "Яндекс Браузер и другие · Android",
    platform: "android",
    browser: "other",
    steps: [
      "Откройте меню браузера (⋮ или ≡).",
      "Найдите пункт «Добавить на главный экран» (в некоторых браузерах — «Добавить ярлык»).",
      "Подтвердите добавление.",
    ],
    note: "Названия пунктов зависят от версии браузера. Если пункта нет, откройте сайт в Chrome.",
  },
  {
    id: "desktop-chrome",
    label: "Chrome · компьютер",
    platform: "desktop",
    browser: "chrome",
    steps: [
      "Нажмите значок установки (монитор со стрелкой) справа в адресной строке.",
      "Нажмите «Установить».",
    ],
    note: "Если значка нет: меню ⋮ → «Сохранить и поделиться» → «Установить страницу как приложение». Ярлык появится в списке приложений и при желании на рабочем столе.",
  },
  {
    id: "desktop-edge",
    label: "Edge · компьютер",
    platform: "desktop",
    browser: "edge",
    steps: [
      "Нажмите значок установки справа в адресной строке или меню ⋯.",
      "Выберите «Приложения» → «Установить этот сайт как приложение».",
      "Нажмите «Установить».",
    ],
  },
  {
    id: "desktop-safari",
    label: "Safari · Mac",
    platform: "desktop",
    browser: "safari",
    steps: [
      "В строке меню выберите «Файл».",
      "Нажмите «Добавить в Dock».",
      "Подтвердите кнопкой «Добавить».",
    ],
    note: "Нужна macOS Sonoma или новее.",
  },
  {
    id: "desktop-other",
    label: "Firefox и другие · компьютер",
    platform: "desktop",
    browser: "other",
    steps: [
      "Эти браузеры обычно не умеют устанавливать сайты как приложения.",
      "Откройте сайт в Chrome или Edge и следуйте их инструкции.",
      "Или добавьте сайт в закладки.",
    ],
  },
];

export function pickInstallMethod(env: InstallEnv): InstallMethod {
  let id: string;
  if (env.platform === "ios") {
    id = env.browser === "safari" ? "ios-safari" : "ios-chrome";
  } else if (env.platform === "android") {
    id = env.browser === "chrome" || env.browser === "samsung" || env.browser === "firefox"
      ? `android-${env.browser}`
      : "android-other";
  } else {
    id = env.browser === "chrome" || env.browser === "edge" || env.browser === "safari"
      ? `desktop-${env.browser}`
      : "desktop-other";
  }

  const method = INSTALL_METHODS.find((candidate) => candidate.id === id);
  if (!method) throw new Error(`Не найдена инструкция по установке: ${id}`);
  return method;
}

export const INSTALL_SEEN_KEY = "vsm:install-seen";

export function hasSeenInstallGuide(): boolean {
  try {
    return localStorage.getItem(INSTALL_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markInstallGuideSeen(): void {
  try {
    localStorage.setItem(INSTALL_SEEN_KEY, "1");
  } catch {
    // Инструкция доступна и без локального хранилища.
  }
}

export function currentInstallEnv(): InstallEnv {
  try {
    return detectInstallEnv({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
      displayModeStandalone: typeof matchMedia === "function"
        ? matchMedia("(display-mode: standalone)").matches
        : false,
    });
  } catch {
    return detectInstallEnv({ userAgent: "" });
  }
}

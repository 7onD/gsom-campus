export interface Prefs {
  groupId: number | null;
  electives: Record<string, string[]>;
}

export interface PrefsDeps {
  local: {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
  } | null;
  cookie: {
    get(): string;
    set(v: string): void;
  };
}

const STORAGE_KEY = "vsm:prefs";
const LEGACY_KEY = "vsm:group";
const COOKIE_KEY = "vsm_prefs";
const COOKIE_LIMIT = 3500;

function defaults(): Prefs {
  return { groupId: null, electives: {} };
}

function validate(value: unknown): Prefs {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return defaults();
  }

  const object = value as Record<string, unknown>;
  const { groupId, electives } = object;
  if (
    !(groupId === null || (typeof groupId === "number" && Number.isFinite(groupId))) ||
    electives === null ||
    typeof electives !== "object" ||
    Array.isArray(electives)
  ) {
    return defaults();
  }

  const selected: Record<string, string[]> = {};
  for (const [group, keys] of Object.entries(electives)) {
    if (!Array.isArray(keys) || !keys.every((key: unknown) => typeof key === "string")) {
      return defaults();
    }
    Object.defineProperty(selected, group, {
      value: [...keys] as string[],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { groupId: groupId as number | null, electives: selected };
}

function decodePrefs(json: string): Prefs {
  try {
    return validate(JSON.parse(json) as unknown);
  } catch {
    return defaults();
  }
}

export function createPrefsStore(deps: PrefsDeps): {
  load(): Prefs;
  save(p: Prefs): void;
} {
  function readCookie(): Prefs {
    try {
      const entry = deps.cookie.get().split(";").map((part) => part.trim())
        .find((part) => part.startsWith(`${COOKIE_KEY}=`));
      if (!entry) return defaults();
      return decodePrefs(decodeURIComponent(entry.slice(COOKIE_KEY.length + 1)));
    } catch {
      return defaults();
    }
  }

  function writeCookie(p: Prefs): void {
    let encoded = encodeURIComponent(JSON.stringify(p));
    if (encoded.length > COOKIE_LIMIT) {
      encoded = encodeURIComponent(JSON.stringify({ groupId: p.groupId, electives: {} }));
    }
    try {
      deps.cookie.set(
        `${COOKIE_KEY}=${encoded}; Max-Age=31536000; Path=/; SameSite=Lax`,
      );
    } catch {
      // Cookie также может быть запрещён браузером.
    }
  }

  function save(p: Prefs): void {
    const valid = validate(p);
    if (deps.local !== null) {
      try {
        deps.local.setItem(STORAGE_KEY, JSON.stringify(valid));
        return;
      } catch {
        // Переключаемся на cookie.
      }
    }
    writeCookie(valid);
  }

  function load(): Prefs {
    if (deps.local !== null) {
      try {
        const saved = deps.local.getItem(STORAGE_KEY);
        if (saved !== null) return decodePrefs(saved);

        const legacy = deps.local.getItem(LEGACY_KEY);
        if (legacy !== null && /^\s*\d+\s*$/.test(legacy)) {
          const groupId = Number(legacy);
          if (Number.isFinite(groupId)) {
            const migrated: Prefs = { groupId, electives: {} };
            save(migrated);
            return migrated;
          }
        }
        return defaults();
      } catch {
        // Чтение localStorage недоступно.
      }
    }
    return readCookie();
  }

  return { load, save };
}

const browserDeps: PrefsDeps = {
  local: (() => {
    try {
      return globalThis.localStorage;
    } catch {
      return null;
    }
  })(),
  cookie: {
    get(): string {
      try {
        return typeof document === "undefined" ? "" : document.cookie;
      } catch {
        return "";
      }
    },
    set(value: string): void {
      try {
        if (typeof document !== "undefined") document.cookie = value;
      } catch {
        // В частности, document может быть недоступен в Node.
      }
    },
  },
};

export const prefsStore = createPrefsStore(browserDeps);

export function loadPrefs(): Prefs {
  return prefsStore.load();
}

export function savePrefs(p: Prefs): void {
  prefsStore.save(p);
}

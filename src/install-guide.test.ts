import assert from "node:assert/strict";
import test from "node:test";
import { detectInstallEnv, INSTALL_METHODS, pickInstallMethod } from "./install-env.ts";

const uas = {
  iosSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iosChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1",
  ipadOs: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  yandexAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 YaBrowser/24.6.0 Mobile Safari/537.36",
  edgeDesktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  firefoxDesktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
};

test("detectInstallEnv: платформа и браузер", () => {
  assert.deepEqual(detectInstallEnv({ userAgent: uas.iosSafari }), { platform: "ios", browser: "safari", standalone: false });
  assert.deepEqual(detectInstallEnv({ userAgent: uas.iosChrome }), { platform: "ios", browser: "chrome", standalone: false });
  assert.equal(detectInstallEnv({ userAgent: uas.ipadOs, maxTouchPoints: 5 }).platform, "ios");
  assert.equal(detectInstallEnv({ userAgent: uas.macSafari, maxTouchPoints: 0 }).platform, "desktop");
  assert.equal(detectInstallEnv({ userAgent: uas.androidChrome }).browser, "chrome");
  assert.equal(detectInstallEnv({ userAgent: uas.samsung }).browser, "samsung");
  assert.equal(detectInstallEnv({ userAgent: uas.yandexAndroid }).browser, "yandex");
  assert.equal(detectInstallEnv({ userAgent: uas.edgeDesktop }).browser, "edge");
  assert.equal(detectInstallEnv({ userAgent: uas.firefoxDesktop }).browser, "firefox");
  assert.equal(detectInstallEnv({ userAgent: uas.iosSafari, standalone: true }).standalone, true);
  assert.equal(detectInstallEnv({ userAgent: uas.androidChrome, displayModeStandalone: true }).standalone, true);
});

test("pickInstallMethod: у каждой среды есть инструкция с шагами", () => {
  const picked = (ua: string, maxTouchPoints?: number) => pickInstallMethod(detectInstallEnv({ userAgent: ua, maxTouchPoints })).id;
  assert.equal(picked(uas.iosSafari), "ios-safari");
  assert.equal(picked(uas.iosChrome), "ios-chrome");
  assert.equal(picked(uas.androidChrome), "android-chrome");
  assert.equal(picked(uas.samsung), "android-samsung");
  assert.equal(picked(uas.yandexAndroid), "android-other");
  assert.equal(picked(uas.edgeDesktop), "desktop-edge");
  assert.equal(picked(uas.macSafari), "desktop-safari");
  assert.equal(picked(uas.firefoxDesktop), "desktop-other");
  assert.equal(new Set(INSTALL_METHODS.map((m) => m.id)).size, INSTALL_METHODS.length);
  for (const method of INSTALL_METHODS) assert.ok(method.steps.length >= 2, method.id);
});

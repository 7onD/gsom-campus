import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

/** Выпускает sw.js со списком файлов сборки; версия кэша — хэш их содержимого. */
function offline(): Plugin {
  return {
    name: "vsm-offline",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      if (process.env.VITE_SW === "off") {
        this.emitFile({ type: "asset", fileName: "sw.js", source: read("./tools/sw-off.js") });
        return;
      }
      const hash = createHash("sha256").update(read("./tools/sw-template.js"));
      const files: string[] = [];
      for (const [name, output] of Object.entries(bundle)) {
        if (name.endsWith(".map")) continue;
        files.push(name);
        hash.update(name).update(output.type === "chunk" ? output.code : output.source);
      }
      for (const name of readdirSync(new URL("./public", import.meta.url))) {
        if (name.startsWith(".")) continue;
        files.push(name);
        hash.update(name).update(readFileSync(new URL(`./public/${name}`, import.meta.url)));
      }
      if (!files.includes("index.html")) this.error("index.html не попал в список файлов офлайн-режима");
      const source = read("./tools/sw-template.js")
        .replace("__VERSION__", hash.digest("hex").slice(0, 12))
        .replace("__FILES__", JSON.stringify(files.sort().map((file) => `./${file}`)));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [offline()],
});

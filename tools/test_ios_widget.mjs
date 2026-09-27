// Проверка скрипта виджета iPhone без iPhone: имитация API Scriptable и вывод виджета текстом.
//   node tools/test_ios_widget.mjs [small|medium|large] [параметр] [ключ группы] [ГГГГ-ММ-ДДTЧЧ:ММ]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const [family = "medium", param = "", groupKey = "1_kurs_rf_1_semestr_2026-2027.pdf#Фортепиано (бак)", fakeNow = ""] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "site/data/schedule.json"), "utf8"));

if (fakeNow) {
  const RealDate = Date, fixed = new RealDate(fakeNow).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [fixed])); }
    static now() { return fixed; }
  };
}

class Color { constructor(hex, a = 1) { this.hex = hex; this.a = a; } static dynamic(light) { return light; } }
const Font = new Proxy({}, { get: (_, name) => (size) => ({ name, size }) });
class Size { constructor(w, h) { this.w = w; this.h = h; } }
class Text { constructor(t) { this.text = t; } }
class Stack {
  constructor() { this.children = []; this.dir = "v"; }
  addStack() { const s = new Stack(); this.children.push(s); return s; }
  addText(t) { const x = new Text(t); this.children.push(x); return x; }
  addSpacer(n) { this.children.push({ spacer: n }); }
  layoutHorizontally() { this.dir = "h"; }
  layoutVertically() { this.dir = "v"; }
  centerAlignContent() {} topAlignContent() {} setPadding() {}
}
function render(node, depth = 0) {
  if (node instanceof Text) return node.text;
  if (!(node instanceof Stack)) return null;
  const parts = node.children.map((c) => render(c, depth + 1)).filter((x) => x);
  return node.dir === "h" ? parts.join("  ") : parts.join("\n");
}
class ListWidget extends Stack {
  async present() { console.log(`┌─ ${family} ${param ? "(" + param + ")" : ""}\n${render(this)}\n└─ url: ${this.url}`); }
  presentSmall() { return this.present(); } presentMedium() { return this.present(); } presentLarge() { return this.present(); }
}
class Request { constructor(url) { this.url = url; } async loadJSON() { return data; } }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scriptable-"));
const FileManager = { local: () => ({
  documentsDirectory: () => dir, joinPath: (a, b) => path.join(a, b),
  writeString: (p, s) => fs.writeFileSync(p, s), readString: (p) => fs.readFileSync(p, "utf8"), fileExists: (p) => fs.existsSync(p),
}) };

const cfg = {
  site: "https://example.github.io/raspisanie/", dataUrl: "https://example.github.io/raspisanie/data/schedule.json",
  groupKey, groupTitle: "Фортепиано (бак) · Бак./спец., 1 курс", lang: "ru",
  personal: [{ id: "t1", title: "Репетиция с концертмейстером", date: "2026-09-29", start: "17:00", end: "18:00", place: "Каб. 411", repeat: "weekly", until: "", skip: [] }],
  tr: {},
};
const src = fs.readFileSync(path.join(root, "site/ios/widget.js"), "utf8").replace("/*CONFIG*/{}", JSON.stringify(cfg));
const globals = { ListWidget, Color, Font, Size, Request, FileManager, config: { runsInWidget: false, widgetFamily: family }, args: { widgetParameter: param }, Script: { setWidget() {}, complete() {} } };
const fn = new (Object.getPrototypeOf(async function () {}).constructor)(...Object.keys(globals), src);
await fn(...Object.values(globals));

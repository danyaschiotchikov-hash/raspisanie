// Расписание Петрозаводской консерватории — виджет для iPhone (приложение Scriptable).
// Скрипт создан на сайте расписания. Параметр виджета: пусто — «Сегодня», «неделя» — ближайшие 7 дней.
// Изменили группу или личные занятия — скопируйте скрипт на сайте заново.

const CONFIG = /*CONFIG*/{};

const ZH = CONFIG.lang === "zh";
const TXT = ZH
  ? { today: "今天", tomorrow: "明天", week: "未来7天", none: "近期没有课", noGroup: "请在网站上设置“我的班级”", offline: "无法加载课表", now: "正在上课", more: "还有" }
  : { today: "Сегодня", tomorrow: "Завтра", week: "Ближайшие 7 дней", none: "Ближайших занятий нет", noGroup: "Выберите свою группу на сайте расписания", offline: "Не удалось загрузить расписание", now: "сейчас", more: "ещё" };
const DAYS = ZH ? ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] : ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

// Контрастные цвета: светлая и тёмная тема iPhone
const C = {
  bg: Color.dynamic(new Color("#FFFFFF"), new Color("#1B1A18")),
  head: Color.dynamic(new Color("#8C2331"), new Color("#7A1E2B")),
  headText: new Color("#FFFFFF"),
  text: Color.dynamic(new Color("#111111"), new Color("#F5F3EF")),
  muted: Color.dynamic(new Color("#3D3833"), new Color("#CBC4BA")),
  past: new Color("#8A837A"),
  accent: Color.dynamic(new Color("#8C2331"), new Color("#F0A3AD")),
  personal: Color.dynamic(new Color("#14606A"), new Color("#7ED3DA")),
  now: Color.dynamic(new Color("#157040"), new Color("#7EDCA9")),
};

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// Повторение личного занятия — та же логика, что на сайте
function occurs(p, ds) {
  if (!p.date || ds < p.date) return false;
  if (p.until && ds > p.until) return false;
  if (p.skip && p.skip.includes(ds)) return false;
  const d0 = parseYmd(p.date), d = parseYmd(ds);
  const diff = Math.round((d - d0) / 86400000);
  switch (p.repeat) {
    case "daily": return true;
    case "weekdays": return d.getDay() >= 1 && d.getDay() <= 5;
    case "weekly": return diff % 7 === 0;
    case "biweekly": return diff % 14 === 0;
    case "monthly": return d.getDate() === d0.getDate();
    default: return diff === 0;
  }
}

// Расписание: с сайта, а без сети — последняя сохранённая копия
async function loadData() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), "raspisanie-schedule.json");
  try {
    const req = new Request(CONFIG.dataUrl);
    req.timeoutInterval = 20;
    const json = await req.loadJSON();
    if (json && json.lessons) {
      fm.writeString(path, JSON.stringify(json));
      return json;
    }
  } catch (e) { /* нет сети */ }
  if (fm.fileExists(path)) return JSON.parse(fm.readString(path));
  return null;
}

function dayItems(data, gid, date) {
  const di = (date.getDay() + 6) % 7, ds = ymd(date);
  const tr = CONFIG.tr || {};
  const out = [];
  if (data && gid) {
    for (const l of data.lessons) {
      if (l.day !== di || !l.groups.includes(gid)) continue;
      const rooms = l.rooms.map((r) => (ZH ? tr[r] || r : r)).join(", ");
      out.push({ start: l.start, end: l.end, title: ZH ? tr[l.subject] || l.subject : l.subject,
        meta: [l.teachers.join(", "), rooms].filter(Boolean).join(" · ") });
    }
  }
  for (const p of CONFIG.personal || []) {
    if (occurs(p, ds)) out.push({ start: p.start, end: p.end, title: p.title, meta: p.place || "", personal: true });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

function dayLabel(d, k) {
  const rel = k === 0 ? TXT.today : k === 1 ? TXT.tomorrow : "";
  const date = ZH ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return (rel ? rel + " · " : "") + DAYS[(d.getDay() + 6) % 7] + ", " + date;
}

async function main() {
  const family = config.widgetFamily || "large";
  const param = String(args.widgetParameter || "").trim().toLowerCase();
  const week = ["неделя", "week", "7", "一周", "本周"].includes(param);
  const small = family === "small";
  const maxRows = { small: 2, medium: 3, large: 7, extraLarge: 7 }[family] || 7;

  const data = await loadData();
  const group = data && CONFIG.groupKey ? data.groups.find((g) => g.key === CONFIG.groupKey) : null;
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // что показать: неделя — 7 дней; сегодня — оставшиеся занятия, а если их нет — ближайший учебный день
  const blocks = [];
  for (let k = 0; k < 7; k++) {
    const d = addDays(today, k);
    let items = dayItems(data, group && group.id, d);
    if (k === 0) items.forEach((it) => { it.past = toMin(it.end) <= nowMin; it.now = toMin(it.start) <= nowMin && nowMin < toMin(it.end); });
    if (!week && k === 0 && items.some((it) => !it.past)) items = items.filter((it) => !it.past || it.now);
    else if (!week && k === 0) items = [];
    if (items.length) blocks.push({ d, k, items });
    if (!week && blocks.length) break;
  }

  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(0, 0, 10, 0);
  w.url = CONFIG.site;
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);

  // шапка в фирменном цвете
  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  head.backgroundColor = C.head;
  head.setPadding(small ? 8 : 10, 14, small ? 8 : 10, 14);
  const hl = head.addStack();
  hl.layoutVertically();
  const title = week ? TXT.week : blocks.length ? dayLabel(blocks[0].d, blocks[0].k) : TXT.today;
  const t = hl.addText(title);
  t.font = Font.boldSystemFont(small ? 13 : 16);
  t.textColor = C.headText;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.8;
  if (!small && CONFIG.groupTitle) {
    const g = hl.addText(CONFIG.groupTitle);
    g.font = Font.mediumSystemFont(12);
    g.textColor = new Color("#FFFFFF", 0.9);
    g.lineLimit = 1;
  }
  head.addSpacer();

  const body = w.addStack();
  body.layoutVertically();
  body.setPadding(8, 14, 0, 14);

  const note = (s) => { const x = body.addText(s); x.font = Font.mediumSystemFont(small ? 13 : 15); x.textColor = C.muted; };
  if (!CONFIG.groupKey && !(CONFIG.personal || []).length) note(TXT.noGroup);
  else if (!data && !(CONFIG.personal || []).length) note(TXT.offline);
  else if (!blocks.length) note(TXT.none);

  let rows = 0, hidden = 0;
  for (const b of blocks) {
    if (rows >= maxRows) { hidden += b.items.length; continue; }
    if (week) {
      const h = body.addText(dayLabel(b.d, b.k));
      h.font = Font.boldSystemFont(13);
      h.textColor = C.accent;
      body.addSpacer(3);
    }
    for (const it of b.items) {
      if (rows >= maxRows) { hidden++; continue; }
      addRow(body, it, small);
      rows++;
    }
    body.addSpacer(week ? 6 : 2);
  }
  if (hidden) {
    const m = body.addText(`${TXT.more} ${hidden}…`);
    m.font = Font.mediumSystemFont(12);
    m.textColor = C.muted;
  }
  w.addSpacer();

  if (config.runsInWidget) Script.setWidget(w);
  else if (small) await w.presentSmall();
  else if (family === "medium") await w.presentMedium();
  else await w.presentLarge();
  Script.complete();
}

function addRow(parent, it, small) {
  const r = parent.addStack();
  r.layoutHorizontally();
  r.topAlignContent();
  r.spacing = 8;

  const bar = r.addStack();
  bar.size = new Size(4, small ? 18 : 36);
  bar.cornerRadius = 2;
  bar.backgroundColor = it.now ? C.now : it.personal ? C.personal : C.accent;

  const tc = r.addStack();
  tc.layoutVertically();
  const s = tc.addText(it.start);
  s.font = Font.boldMonospacedSystemFont(small ? 13 : 15);
  s.textColor = it.past ? C.past : C.text;
  if (!small) {
    const e = tc.addText(it.end);
    e.font = Font.regularMonospacedSystemFont(12);
    e.textColor = C.muted;
  }

  const col = r.addStack();
  col.layoutVertically();
  const tt = col.addText(it.now ? `${it.title} · ${TXT.now}` : it.title);
  tt.font = Font.semiboldSystemFont(small ? 13 : 15);
  tt.textColor = it.past ? C.past : C.text;
  tt.lineLimit = small ? 2 : 1;
  if (!small && it.meta) {
    const mm = col.addText(it.meta);
    mm.font = Font.systemFont(13);
    mm.textColor = C.muted;
    mm.lineLimit = 1;
  }
  parent.addSpacer(small ? 4 : 7);
}

await main();

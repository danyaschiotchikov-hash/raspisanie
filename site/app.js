/* Расписание Петрозаводской консерватории — клиентская часть. */
(() => {
  "use strict";
  const I = window.I18N;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DESKTOP = window.matchMedia("(min-width: 1024px)");

  const ICON = {
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9Z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/><rect x="8.5" y="5.5" width="7" height="5" rx="1"/></svg>',
    apple: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.37 12.57c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.47.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.77-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.39-.92-2.41-3.65ZM14.1 5.8c.63-.77 1.06-1.83.94-2.9-.91.04-2.02.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.02.08 2.06-.52 2.69-1.27Z"/></svg>',
    android: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 9.48 19.44 6.3a.38.38 0 0 0-.66-.38l-1.87 3.23a11.43 11.43 0 0 0-9.82 0L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.78 10.78 0 0 0 1 18h22a10.78 10.78 0 0 0-5.4-8.52ZM7 15.25a1.25 1.25 0 1 1 1.25-1.25A1.25 1.25 0 0 1 7 15.25Zm10 0A1.25 1.25 0 1 1 18.25 14 1.25 1.25 0 0 1 17 15.25Z"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  };

  // ------------------------------------------------------------ настройки
  const LS_KEY = "rasp.v2";
  const prefs = Object.assign(
    { lang: (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "ru", myGroup: null, mode: "group", group: null, teacher: null, personal: [] },
    readLS()
  );
  function readLS() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
  function savePrefs() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch { /* недоступно */ }
    pushToAndroid();
  }

  // ------------------------------------------------------------ язык
  const L = () => (prefs.lang === "zh" ? "zh" : "ru");
  const t = (k, ...a) => { const v = I.ui[L()][k] ?? I.ui.ru[k]; return typeof v === "function" ? v(...a) : v; };
  const Z = I.zh;
  const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

  function trSubject(s) {
    if (L() !== "zh" || !s) return s;
    if (Z.subjects[s]) return Z.subjects[s];
    const m = s.match(/^(.*?)\s*\(([^)]+)\)$/);
    if (m && Z.subjects[m[1]]) return `${Z.subjects[m[1]]}（${Z.suffixes[m[2]] || m[2]}）`;
    return s;
  }
  function trGroup(name) {
    if (L() !== "zh") return name;
    if (Z.groups[name]) return Z.groups[name];
    const m = name.match(/^(.*?)\s*\((бак|спец)\)\s*(.*)$/);
    if (m) {
      const base = Z.groups[m[1]] || m[1];
      const tail = m[3] ? " · " + (Z.groups[m[3]] || m[3]) : "";
      return `${base}（${Z.groups[m[2]]}）${tail}`;
    }
    return name;
  }
  const trRoom = (r) => (L() !== "zh" ? r : Z.rooms[r] || r.replace(/^Каб\.\s*/, "教室 "));
  function trProgram(s) {
    if (L() !== "zh") return s.program;
    return (Z.programs[s.level] || s.level) + (s.foreign ? " · " + Z.programs["иностранные студенты"] : "");
  }
  const trCourse = (s) => (s.course ? (L() === "zh" ? `${s.course}年级` : s.courseLabel) : t("allCourses"));
  function shortSource(s) {
    if (L() === "zh") return (Z.programsShort[s.level] || s.level) + (s.course ? ` ${s.course}年级` : "") + (s.foreign ? "（留学生）" : "");
    const lv = { "Колледж (СПО)": "СПО", "Бакалавриат и специалитет": "Бак./спец.", "Магистратура": "Магистратура", "Аспирантура": "Аспирантура", "Ассистентура-стажировка": "Ассистентура" }[s.level] || s.level;
    return lv + (s.course ? `, ${s.course} курс` : "") + (s.foreign ? " (ин.)" : "");
  }
  function trIndividual(text) {
    const items = text.split(/(?<=\.)\s*(?=[А-ЯЁ])/).map((x) => x.trim().replace(/\.$/, "")).filter(Boolean);
    if (L() !== "zh") return items.join(". ") + ".";
    return items.map((x) => Z.individual[x] || x).join("；");
  }
  const dayName = (i) => I.days[L()][i];
  const dayShort = (i) => I.daysShort[L()][i];
  const fmtDM = (d) => (L() === "zh" ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`);
  const fmtDMShort = (d) => (L() === "zh" ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`);
  const fmtIso = (iso) => fmtDM(parseYmd(iso));

  // ------------------------------------------------------------ даты
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const todayDow = () => (new Date().getDay() + 6) % 7;
  function calendarMonday() { const n = new Date(); n.setHours(0, 0, 0, 0); return addDays(n, -todayDow()); }
  const defaultWeek = () => (todayDow() === 6 ? 1 : 0); // в воскресенье сразу показываем следующую неделю

  // ------------------------------------------------------------ состояние
  let D = null;
  let idx = {};
  const st = { mode: prefs.mode === "teacher" ? "teacher" : "group", groupId: null, sourceId: null, teacher: null, week: defaultWeek(), ctlOpen: false, scrollToday: true, items: {} };

  function setData(data) {
    D = data;
    idx = { source: {}, group: {}, groupByKey: {}, byGroup: {}, byTeacher: {} };
    D.sources.forEach((s) => (idx.source[s.id] = s));
    D.groups.forEach((g) => { idx.group[g.id] = g; idx.groupByKey[g.key] = g; });
    D.lessons.forEach((l) => {
      l.groups.forEach((g) => (idx.byGroup[g] ||= []).push(l));
      l.teachers.forEach((x) => (idx.byTeacher[x] ||= []).push(l));
    });
  }
  function selectGroupKey(key) {
    const g = key && idx.groupByKey[key];
    if (!g) return false;
    st.groupId = g.id; st.sourceId = g.source;
    return true;
  }
  function restoreSelection() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get("g") && selectGroupKey(h.get("g"))) { st.mode = "group"; }
    else if (h.get("t") && idx.byTeacher[h.get("t")]) { st.mode = "teacher"; st.teacher = h.get("t"); }
    if (!st.groupId) selectGroupKey(prefs.myGroup) || selectGroupKey(prefs.group);
    if (!st.teacher && prefs.teacher && idx.byTeacher[prefs.teacher]) st.teacher = prefs.teacher;
    if (!h.get("g") && !h.get("t") && prefs.myGroup && idx.groupByKey[prefs.myGroup]) st.mode = "group";
    if (!st.sourceId) st.sourceId = D.sources[0]?.id;
    st.ctlOpen = st.mode === "group" ? !st.groupId : !st.teacher;
  }
  function remember() {
    prefs.mode = st.mode;
    if (st.groupId) prefs.group = idx.group[st.groupId].key;
    if (st.teacher) prefs.teacher = st.teacher;
    savePrefs();
    let h = "";
    if (st.mode === "group" && st.groupId) h = "g=" + encodeURIComponent(idx.group[st.groupId].key);
    if (st.mode === "teacher" && st.teacher) h = "t=" + encodeURIComponent(st.teacher);
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }
  const isMine = () => st.mode === "group" && st.groupId && (!prefs.myGroup || idx.group[st.groupId]?.key === prefs.myGroup);

  // ------------------------------------------------------------ личные занятия
  function occurs(p, dateStr) {
    if (dateStr < p.date) return false;
    if (p.until && dateStr > p.until) return false;
    if (p.skip && p.skip.includes(dateStr)) return false;
    const d0 = parseYmd(p.date), d = parseYmd(dateStr);
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
  function repeatLabel(p) {
    const r = { none: "rNone", daily: "rDaily", weekdays: "rWeekdays", weekly: "rWeekly", biweekly: "rBiweekly", monthly: "rMonthly" }[p.repeat] || "rNone";
    if (p.repeat === "none" || !p.repeat) return `${dayName((parseYmd(p.date).getDay() + 6) % 7)}, ${fmtIso(p.date)}`;
    return `${t(r)}, ${t("from", fmtIso(p.date))}${p.until ? " " + t("until", fmtIso(p.until)) : ""}`;
  }

  // ------------------------------------------------------------ данные недели
  function weekMonday() { return addDays(calendarMonday(), st.week * 7); }
  function currentLessons() {
    if (st.mode === "group") return st.groupId ? idx.byGroup[st.groupId] || [] : [];
    return st.teacher ? idx.byTeacher[st.teacher] || [] : [];
  }
  function weekItems(monday) {
    const lessons = currentLessons();
    const withPersonal = isMine();
    const today = ymd(new Date());
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    st.items = {};
    return [0, 1, 2, 3, 4, 5, 6].map((di) => {
      const date = addDays(monday, di), ds = ymd(date);
      const list = [];
      lessons.filter((l) => l.day === di).forEach((l) => list.push({ kind: "lesson", id: `l${l.id}@${ds}`, start: l.start, end: l.end, l, ds }));
      if (withPersonal) prefs.personal.filter((p) => occurs(p, ds)).forEach((p) => list.push({ kind: "personal", id: `p${p.id}@${ds}`, start: p.start, end: p.end, p, ds }));
      list.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
      list.forEach((it, i) => {
        it.now = ds === today && toMin(it.start) <= nowMin && nowMin < toMin(it.end);
        it.par = list.some((o, j) => j !== i && toMin(o.start) < toMin(it.end) && toMin(it.start) < toMin(o.end));
        st.items[it.id] = it;
      });
      return { di, date, ds, today: ds === today, list };
    });
  }
  function semesterWeek(monday) {
    if (!D || D.semester.sem !== 1) return null;
    const sep1 = new Date(D.semester.year, 8, 1);
    const start = addDays(sep1, -((sep1.getDay() + 6) % 7));
    const n = Math.floor(Math.round((monday - start) / 86400000) / 7) + 1;
    return n >= 1 && n <= 24 ? n : null;
  }

  // ------------------------------------------------------------ подписи
  const itemTitle = (it) => (it.kind === "lesson" ? trSubject(it.l.subject) : it.p.title);
  function itemMeta(it, withIcons) {
    const parts = [];
    if (it.kind === "lesson") {
      const tt = st.mode === "teacher" ? it.l.teachers.filter((x) => x !== st.teacher) : it.l.teachers;
      if (tt.length) parts.push((withIcons ? `<span class="ico">${ICON.user}` : "<span>") + (st.mode === "teacher" ? t("together") + ": " : "") + esc(tt.join(", ")) + "</span>");
      if (it.l.rooms.length) parts.push((withIcons ? `<span class="ico">${ICON.pin}` : "<span>") + esc(it.l.rooms.map(trRoom).join(", ")) + "</span>");
    } else if (it.p.place) {
      parts.push((withIcons ? `<span class="ico">${ICON.pin}` : "<span>") + esc(it.p.place) + "</span>");
    }
    return parts.join(withIcons ? "" : " · ");
  }
  function groupsBrief(ids) {
    const bySrc = new Map();
    ids.forEach((id) => { const g = idx.group[id]; if (!bySrc.has(g.source)) bySrc.set(g.source, []); bySrc.get(g.source).push(g); });
    return [...bySrc.entries()].map(([sid, gs]) => {
      const s = shortSource(idx.source[sid]);
      return gs.length <= 2 ? `${s}: ${gs.map((g) => trGroup(g.name)).join(", ")}` : `${s} · ${t("specialtiesN", gs.length)}`;
    }).join("; ");
  }
  function tagsHTML(it) {
    const tags = [];
    if (it.now) tags.push(`<span class="tag now">${esc(t("now"))}</span>`);
    if (it.kind === "personal") tags.push(`<span class="tag personal">${esc(t("personal"))}</span>`);
    if (it.par) tags.push(`<span class="tag par" title="${esc(t("parallelHint"))}">${esc(t("parallel"))}</span>`);
    return tags.length ? `<div class="tags">${tags.join("")}</div>` : "";
  }

  // ------------------------------------------------------------ шапка / язык
  function renderStatic() {
    document.documentElement.lang = L();
    $$("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
    $$(".langs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === L())));
    const n = prefs.personal.length;
    $("#personal-count").hidden = !n;
    $("#personal-count").textContent = n;
    document.title = L() === "zh" ? "音乐学院课程表" : "Расписание консерватории";
  }

  // ------------------------------------------------------------ панель выбора
  function renderControls() {
    const c = $("#controls");
    c.classList.toggle("open", st.ctlOpen);
    let sumTitle = "", sumSub = "";
    if (st.mode === "group" && st.groupId) {
      const g = idx.group[st.groupId], s = idx.source[g.source];
      sumTitle = (prefs.myGroup === g.key ? ICON.star + " " : "") + esc(trGroup(g.name));
      sumSub = esc(`${trProgram(s)} · ${trCourse(s)}`);
    } else if (st.mode === "teacher" && st.teacher) {
      sumTitle = esc(st.teacher);
      sumSub = esc(t("teacher"));
    } else {
      sumTitle = esc(st.mode === "group" ? t("chooseGroup") : t("chooseTeacher"));
    }

    const summary = `<div class="ctl-summary">
      <div class="sum"><b>${sumTitle}</b>${sumSub ? `<span>${sumSub}</span>` : ""}</div>
      ${prefs.myGroup && !(st.mode === "group" && idx.group[st.groupId]?.key === prefs.myGroup) && idx.groupByKey[prefs.myGroup]
        ? `<button type="button" class="btn" data-act="mine">${ICON.star}<span>${esc(t("toMyGroup"))}</span></button>` : ""}
      <button type="button" class="btn" data-act="toggle">${esc(st.ctlOpen ? t("done") : t("change"))}</button>
    </div>`;

    const seg = `<div class="seg" role="group">
      <button type="button" data-mode="group" aria-pressed="${st.mode === "group"}">${esc(t("byGroup"))}</button>
      <button type="button" data-mode="teacher" aria-pressed="${st.mode === "teacher"}">${esc(t("byTeacher"))}</button>
    </div>`;

    let body = "";
    if (st.mode === "group") {
      const programs = [];
      D.sources.forEach((s) => {
        let pg = programs.find((x) => x.key === s.program);
        if (!pg) programs.push((pg = { key: s.program, name: trProgram(s), items: [] }));
        pg.items.push(s);
      });
      const opts = programs.map((pg) => `<optgroup label="${esc(pg.name)}">${pg.items.map((s) =>
        `<option value="${s.id}"${s.id === st.sourceId ? " selected" : ""}>${esc(trProgram(s))} — ${esc(trCourse(s))}</option>`).join("")}</optgroup>`).join("");
      const groups = D.groups.filter((g) => g.source === st.sourceId);
      const gopts = (st.groupId && idx.group[st.groupId].source === st.sourceId ? "" : `<option value="" selected disabled>—</option>`) +
        groups.map((g) => `<option value="${g.id}"${g.id === st.groupId ? " selected" : ""}>${esc(trGroup(g.name))}</option>`).join("");
      const mine = st.groupId && prefs.myGroup === idx.group[st.groupId].key;
      body = `${seg}
        <label class="field f-program"><span>${esc(t("programCourse"))}</span><select id="sel-src">${opts}</select></label>
        <label class="field f-group"><span>${esc(t("specialty"))}</span><select id="sel-group">${gopts}</select></label>
        <button type="button" class="btn star" id="btn-star" aria-pressed="${mine}" ${st.groupId ? "" : "disabled"}>${ICON.star}<span>${esc(mine ? t("myGroup") : t("makeMyGroup"))}</span></button>`;
    } else {
      body = `${seg}
        <div class="field f-teacher"><span>${esc(t("teacher"))}</span>
          <div class="ac"><input type="search" id="ac-input" placeholder="${esc(t("searchTeacher"))}" autocomplete="off" spellcheck="false" value="${esc(st.teacher || "")}" role="combobox" aria-expanded="false" aria-controls="ac-list" aria-autocomplete="list">
          <ul class="ac-list" id="ac-list" role="listbox" hidden></ul></div></div>`;
    }
    const hint = st.mode === "group" && !prefs.myGroup
      ? `<div class="hint">${ICON.info}<span>${esc(t("hintMyGroup"))}</span></div>` : "";
    c.innerHTML = summary + `<div class="ctl-body">${body}</div>` + hint;

    c.querySelector("[data-act=toggle]").onclick = () => { st.ctlOpen = !st.ctlOpen; renderControls(); };
    const mineBtn = c.querySelector("[data-act=mine]");
    if (mineBtn) mineBtn.onclick = goMine;
    $$(".seg button", c).forEach((b) => (b.onclick = () => {
      st.mode = b.dataset.mode; st.ctlOpen = st.mode === "group" ? !st.groupId || st.ctlOpen : true;
      update();
      if (st.mode === "teacher") setTimeout(() => $("#ac-input")?.focus(), 0);
    }));
    if (st.mode === "group") {
      $("#sel-src").onchange = (e) => { st.sourceId = e.target.value; st.groupId = null; renderControls(); renderAll(false); };
      $("#sel-group").onchange = (e) => { st.groupId = e.target.value; st.ctlOpen = DESKTOP.matches; st.scrollToday = true; update(); };
      $("#btn-star").onclick = () => {
        const key = idx.group[st.groupId].key;
        prefs.myGroup = prefs.myGroup === key ? null : key;
        savePrefs(); update();
      };
    } else {
      setupAutocomplete();
    }
  }
  function goMine() {
    if (selectGroupKey(prefs.myGroup)) { st.mode = "group"; st.ctlOpen = false; st.scrollToday = true; update(); }
  }

  function setupAutocomplete() {
    const inp = $("#ac-input"), list = $("#ac-list");
    let active = -1, matches = [];
    const norm = (s) => s.toLowerCase().replace(/ё/g, "е");
    const close = () => { list.hidden = true; inp.setAttribute("aria-expanded", "false"); active = -1; };
    const pick = (name) => { st.teacher = name; close(); st.ctlOpen = DESKTOP.matches; st.scrollToday = true; update(); };
    function show() {
      const q = norm(inp.value.trim());
      if (!q || (st.teacher && inp.value === st.teacher)) return close();
      matches = D.teachers.filter((x) => norm(x).includes(q))
        .sort((a, b) => (norm(b).startsWith(q) - norm(a).startsWith(q)) || a.localeCompare(b, "ru")).slice(0, 8);
      active = matches.length ? 0 : -1;
      list.innerHTML = matches.length
        ? matches.map((x, i) => {
            const k = norm(x).indexOf(q);
            const label = esc(x.slice(0, k)) + "<mark>" + esc(x.slice(k, k + q.length)) + "</mark>" + esc(x.slice(k + q.length));
            return `<li role="option" data-i="${i}" aria-selected="${i === active}"><span>${label}</span><span class="n">${(idx.byTeacher[x] || []).length}</span></li>`;
          }).join("")
        : `<li class="empty">${esc(t("nobody"))}</li>`;
      list.hidden = false; inp.setAttribute("aria-expanded", "true");
    }
    const mark = () => $$("li[data-i]", list).forEach((li) => li.setAttribute("aria-selected", String(+li.dataset.i === active)));
    inp.addEventListener("input", show);
    inp.addEventListener("focus", () => { if (inp.value === st.teacher) inp.select(); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && matches.length) { active = (active + 1) % matches.length; mark(); e.preventDefault(); }
      else if (e.key === "ArrowUp" && matches.length) { active = (active - 1 + matches.length) % matches.length; mark(); e.preventDefault(); }
      else if (e.key === "Enter" && active >= 0 && !list.hidden) { pick(matches[active]); e.preventDefault(); }
      else if (e.key === "Escape") close();
    });
    list.addEventListener("mousedown", (e) => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); pick(matches[+li.dataset.i]); } });
    inp.addEventListener("blur", () => setTimeout(close, 120));
  }

  // ------------------------------------------------------------ заголовок (ПК)
  function renderTitle() {
    const box = $("#titlebar");
    if (st.mode === "group" && st.groupId) {
      const g = idx.group[st.groupId], s = idx.source[g.source];
      box.innerHTML = `<div class="titlebar"><div>
          <h2>${esc(trGroup(g.name))}</h2>
          <div class="meta">${esc(trProgram(s))} · ${esc(trCourse(s))} · <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(t("sourcePdf"))} ↗</a>${s.updated ? " · " + esc(t("fileFrom", fmtIso(s.updated))) : ""}</div>
        </div></div>` +
        (g.individual ? `<details class="indiv"${DESKTOP.matches ? " open" : ""}><summary>${esc(t("individual"))}</summary>${esc(trIndividual(g.individual))}</details>` : "");
    } else if (st.mode === "teacher" && st.teacher) {
      const ls = idx.byTeacher[st.teacher] || [];
      const ng = new Set(ls.flatMap((l) => l.groups)).size;
      box.innerHTML = `<div class="titlebar"><div><h2>${esc(st.teacher)}</h2><div class="meta">${esc(t("lessonsWeek", ls.length))} · ${esc(t("groupsN", ng))}</div></div></div>`;
    } else box.innerHTML = "";
  }

  // ------------------------------------------------------------ неделя
  function renderWeekbar(days) {
    const mon = days[0].date, last = days[days[6].list.length ? 6 : 5].date;
    const wn = semesterWeek(mon);
    const showSun = days[6].list.length > 0;
    const range = L() === "zh" ? `${fmtDMShort(mon)} – ${fmtDMShort(last)}` : `${fmtDM(mon)} – ${fmtDM(last)}`;
    const isCurrent = st.week === defaultWeek() || st.week === 0;
    $("#weekbar").innerHTML = `<div class="wb-main">
        <button type="button" class="btn icon-btn" data-w="-1" aria-label="${esc(t("prevWeek"))}">${ICON.prev}</button>
        <div class="wb-range"><b>${esc(range)}</b><span>${esc(wn ? t("weekOfSem", wn) : st.week === 0 ? t("thisWeek") : "")}</span></div>
        <button type="button" class="btn icon-btn" data-w="1" aria-label="${esc(t("nextWeek"))}">${ICON.next}</button>
        <div class="wb-spacer"></div>
        <button type="button" class="btn" data-w="0" ${isCurrent ? "hidden" : ""}>${esc(t("today"))}</button>
        <button type="button" class="btn icon-btn hide-m" data-act="print" aria-label="${esc(t("print"))}">${ICON.print}</button>
      </div>
      <nav class="strip" aria-label="Дни">${days.filter((d) => d.di < 6 || showSun).map((d) =>
        `<a href="#d-${d.di}" data-day="${d.di}" class="${d.today ? "today" : ""} ${d.list.length ? "has" : "none"}">${esc(dayShort(d.di))}<b>${d.date.getDate()}</b></a>`).join("")}</nav>`;
    $$("[data-w]", $("#weekbar")).forEach((b) => (b.onclick = () => {
      const w = +b.dataset.w;
      st.week = w === 0 ? 0 : st.week + w; st.scrollToday = w === 0;
      renderSchedule();
    }));
    $("[data-act=print]", $("#weekbar")).onclick = () => window.print();
    $$(".strip a", $("#weekbar")).forEach((a) => (a.onclick = (e) => {
      e.preventDefault();
      document.getElementById("d-" + a.dataset.day)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }

  function renderSchedule() {
    const box = $("#schedule");
    if (!(st.mode === "group" ? st.groupId : st.teacher)) {
      $("#weekbar").innerHTML = "";
      box.innerHTML = `<div class="loading">${esc(st.mode === "group" ? t("chooseGroup") : t("chooseTeacher"))}</div>`;
      return;
    }
    const days = weekItems(weekMonday());
    renderWeekbar(days);
    box.innerHTML = DESKTOP.matches ? gridHTML(days) : feedHTML(days);
    $$("[data-item]", box).forEach((el) => (el.onclick = () => openItem(el.dataset.item)));
    $$("[data-add]", box).forEach((el) => (el.onclick = (e) => { e.stopPropagation(); openEdit(null, el.dataset.add); }));
    if (!DESKTOP.matches && st.scrollToday) {
      const td = days.find((d) => d.today);
      if (td) requestAnimationFrame(() => document.getElementById("d-" + td.di)?.scrollIntoView({ block: "start" }));
    }
    st.scrollToday = false;
  }

  // сетка недели для компьютера: строки — начало пар, столбцы — дни по порядку
  function gridHTML(days) {
    const cols = days[6].list.length ? 7 : 6;
    const shown = days.slice(0, cols);
    const all = shown.flatMap((d) => d.list);
    const starts = [...new Set(all.map((i) => i.start))].sort();
    const head = shown.map((d, c) => `<div class="dh${d.today ? " today" : ""}" style="grid-column:${c + 2}">
        <span class="dn">${esc(dayName(d.di))}</span><span class="dd">${esc((d.today ? t("todayLower") + ", " : "") + fmtDMShort(d.date))}</span>
        ${isMine() ? `<button type="button" class="add" data-add="${d.ds}" aria-label="${esc(t("addPersonal"))}">${ICON.plus}</button>` : ""}
      </div>`).join("");
    if (!starts.length) return `<div class="wk" style="--cols:${cols}"><div class="corner"></div>${head}<div class="empty-week">${esc(t("emptyWeek"))}</div></div>`;

    const endRow = (e) => { const k = starts.findIndex((s) => s >= e); return k === -1 ? starts.length : k; };
    let html = `<div class="wk" style="--cols:${cols}"><div class="corner"></div>${head}`;
    starts.forEach((s, r) => {
      const ends = all.filter((i) => i.start === s).map((i) => i.end);
      const end = ends.sort((a, b) => ends.filter((x) => x === b).length - ends.filter((x) => x === a).length)[0];
      html += `<div class="rl" style="grid-row:${r + 2}"><b>${s}</b><span>${end}</span></div>`;
      shown.forEach((d, c) => (html += `<div class="bg${d.today ? " today" : ""}" style="grid-row:${r + 2};grid-column:${c + 2}"></div>`));
    });
    shown.forEach((d, c) => {
      const clusters = [];
      d.list.forEach((it) => {
        const rs = starts.indexOf(it.start), re = Math.max(endRow(it.end), rs + 1);
        const cur = clusters[clusters.length - 1];
        if (cur && rs < cur.re) { cur.items.push(it); cur.re = Math.max(cur.re, re); }
        else clusters.push({ rs, re, items: [it] });
      });
      clusters.forEach((cl) => {
        html += `<div class="slot" style="grid-column:${c + 2};grid-row:${cl.rs + 2} / ${cl.re + 2}">` +
          cl.items.map((it) => `<button type="button" class="card k-${it.kind}${it.now ? " now" : ""}" data-item="${it.id}">
              <span class="c-time">${it.start}–${it.end}</span>
              <span class="c-title">${esc(itemTitle(it))}</span>
              ${itemMeta(it, false) ? `<span class="c-meta">${itemMeta(it, false)}</span>` : ""}
              ${st.mode === "teacher" && it.kind === "lesson" ? `<span class="c-groups">${esc(groupsBrief(it.l.groups))}</span>` : ""}
              ${tagsHTML(it)}
            </button>`).join("") + `</div>`;
      });
    });
    return html + `</div>`;
  }

  // лента для телефона
  function feedHTML(days) {
    const showSun = days[6].list.length > 0;
    return `<div class="feed">${days.filter((d) => d.di < 6 || showSun).map((d) => {
      const rel = d.today ? t("todayLower") : ymd(addDays(new Date(), 1)) === d.ds ? t("tomorrow") : "";
      return `<section class="fday${d.today ? " today" : ""}" id="d-${d.di}">
        <header><h3>${esc(dayName(d.di))}<small>${esc(fmtDM(d.date))}${rel ? " · " + esc(rel) : ""}</small></h3>
          ${isMine() ? `<button type="button" class="add" data-add="${d.ds}" aria-label="${esc(t("addPersonal"))}">${ICON.plus}</button>` : ""}</header>
        ${d.list.length ? `<ol class="tl">${d.list.map((it) => `<li class="ev k-${it.kind}${it.now ? " now" : ""}" data-item="${it.id}" tabindex="0">
            <div class="ev-time"><b>${it.start}</b><span>${it.end}</span></div>
            <div class="ev-rail"></div>
            <div><div class="ev-title">${esc(itemTitle(it))}</div>
              ${itemMeta(it, true) ? `<div class="ev-meta">${itemMeta(it, true)}</div>` : ""}
              ${it.kind === "lesson" && it.l.exact.length > 1 ? `<span class="alt">${esc(it.l.exact.join(", "))}</span>` : ""}
              ${st.mode === "teacher" && it.kind === "lesson" ? `<div class="ev-groups">${esc(groupsBrief(it.l.groups))}</div>` : ""}
              ${tagsHTML(it)}</div>
          </li>`).join("")}</ol>` : `<p class="fnone">${esc(d.di === 6 ? t("dayOff") : t("noLessons"))}</p>`}
      </section>`;
    }).join("")}</div>`;
  }

  // ------------------------------------------------------------ подробности
  function openItem(id) {
    const it = st.items[id];
    if (!it) return;
    if (it.kind === "personal") return openEdit(it.p, it.ds);
    const l = it.l, d = parseYmd(it.ds);
    const bySrc = new Map();
    l.groups.forEach((gid) => { const g = idx.group[gid]; if (!bySrc.has(g.source)) bySrc.set(g.source, []); bySrc.get(g.source).push(g); });
    const groupsHtml = [...bySrc.entries()].map(([sid, gs]) =>
      `<div><span class="gl-src">${esc(shortSource(idx.source[sid]))}:</span> ${gs.map((g) => `<button type="button" class="link" data-g="${g.id}">${esc(trGroup(g.name))}</button>`).join(", ")}</div>`).join("");
    const srcLinks = [...bySrc.keys()].map((sid) => `<a href="${esc(idx.source[sid].url)}" target="_blank" rel="noopener">${esc(shortSource(idx.source[sid]))} ↗</a>`).join(" · ");
    const dlg = $("#dlg-item");
    dlg.innerHTML = `<div class="dlg">
      <div class="dlg-head"><h3>${esc(trSubject(l.subject))}${L() === "zh" && trSubject(l.subject) !== l.subject ? `<span class="orig">${esc(l.subject)}</span>` : ""}</h3>
        <button type="button" class="btn icon-btn ghost" data-close aria-label="${esc(t("close"))}">${ICON.x}</button></div>
      <div class="dlg-body">
        ${tagsHTML(it)}
        <dl class="kv">
          <dt>${esc(t("time"))}</dt><dd>${esc(dayName(it.ds ? (d.getDay() + 6) % 7 : l.day))}, ${esc(fmtDM(d))} · <b>${l.start}–${l.end}</b>${l.exact.length > 1 ? `<br><span style="color:var(--muted)">${esc(l.exact.join(", "))}</span>` : ""}</dd>
          ${l.teachers.length ? `<dt>${esc(t("teachers"))}</dt><dd>${l.teachers.map((x) => `<button type="button" class="link" data-t="${esc(x)}">${esc(x)}</button>`).join(", ")}</dd>` : ""}
          ${l.rooms.length ? `<dt>${esc(t("room"))}</dt><dd>${esc(l.rooms.map(trRoom).join(", "))}</dd>` : ""}
          <dt>${esc(t("groups"))}</dt><dd style="display:grid;gap:4px">${groupsHtml}</dd>
        </dl>
        <div class="raw">«${esc(l.text)}»<br>${srcLinks}</div>
      </div></div>`;
    $("[data-close]", dlg).onclick = () => dlg.close();
    $$("[data-t]", dlg).forEach((b) => (b.onclick = () => { dlg.close(); st.mode = "teacher"; st.teacher = b.dataset.t; st.ctlOpen = false; update(); scrollTop(); }));
    $$("[data-g]", dlg).forEach((b) => (b.onclick = () => { dlg.close(); const g = idx.group[b.dataset.g]; st.mode = "group"; st.groupId = g.id; st.sourceId = g.source; st.ctlOpen = false; update(); scrollTop(); }));
    showDialog(dlg);
  }
  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
  function showDialog(dlg) {
    if (!dlg.open) dlg.showModal();
    dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  }

  // ------------------------------------------------------------ личные занятия: форма и список
  function openEdit(p, dateStr) {
    const isNew = !p;
    const v = p || { title: "", date: dateStr || ymd(new Date()), start: "18:30", end: "20:00", place: "", note: "", repeat: "none", until: "" };
    const recurring = !isNew && v.repeat && v.repeat !== "none";
    const dlg = $("#dlg-edit");
    const opt = (val, key) => `<option value="${val}"${v.repeat === val ? " selected" : ""}>${esc(t(key))}</option>`;
    dlg.innerHTML = `<form class="dlg" method="dialog" novalidate>
      <div class="dlg-head"><h3>${esc(isNew ? t("newPersonal") : t("editPersonal"))}</h3>
        <button type="button" class="btn icon-btn ghost" data-close aria-label="${esc(t("close"))}">${ICON.x}</button></div>
      <div class="dlg-body"><div class="form">
        <label class="field full"><span>${esc(t("fTitle"))}</span><input type="text" name="title" required maxlength="120" placeholder="${esc(t("fTitlePh"))}" value="${esc(v.title)}"></label>
        <label class="field full"><span>${esc(t("fDate"))}</span><input type="date" name="date" required value="${esc(isNew ? v.date : dateStr && recurring ? v.date : v.date)}"></label>
        <label class="field"><span>${esc(t("fStart"))}</span><input type="time" step="60" name="start" required value="${esc(v.start)}"></label>
        <label class="field"><span>${esc(t("fEnd"))}</span><input type="time" step="60" name="end" required value="${esc(v.end)}"></label>
        <label class="field full"><span>${esc(t("fPlace"))}</span><input type="text" name="place" maxlength="120" placeholder="${esc(t("fPlacePh"))}" value="${esc(v.place || "")}"></label>
        <label class="field"><span>${esc(t("fRepeat"))}</span><select name="repeat">
          ${opt("none", "rNone")}${opt("daily", "rDaily")}${opt("weekdays", "rWeekdays")}${opt("weekly", "rWeekly")}${opt("biweekly", "rBiweekly")}${opt("monthly", "rMonthly")}</select></label>
        <label class="field" data-until><span>${esc(t("fUntil"))}</span><input type="date" name="until" value="${esc(v.until || "")}" title="${esc(t("fUntilNone"))}"></label>
        <label class="field full"><span>${esc(t("fNote"))}</span><textarea name="note" maxlength="500">${esc(v.note || "")}</textarea></label>
        <div class="err" hidden></div>
      </div></div>
      <div class="dlg-foot">
        ${isNew ? "" : `<div class="left">${recurring
          ? `<button type="button" class="btn danger" data-del="one">${esc(t("delOne"))}</button><button type="button" class="btn danger" data-del="all">${esc(t("delAll"))}</button>`
          : `<button type="button" class="btn danger" data-del="all">${esc(t("del"))}</button>`}</div>`}
        <button type="button" class="btn" data-close>${esc(t("cancel"))}</button>
        <button type="submit" class="btn primary">${esc(t("save"))}</button>
      </div></form>`;
    const f = $("form", dlg);
    const syncUntil = () => ($("[data-until]", dlg).hidden = f.repeat.value === "none");
    f.repeat.onchange = syncUntil; syncUntil();
    $$("[data-close]", dlg).forEach((b) => (b.onclick = () => dlg.close()));
    f.onsubmit = (e) => {
      e.preventDefault();
      const err = $(".err", dlg);
      const title = f.title.value.trim();
      if (!title) { f.title.focus(); return; }
      if (!f.date.value || !f.start.value || !f.end.value) return;
      if (f.end.value <= f.start.value) { err.textContent = t("errTime"); err.hidden = false; return; }
      const rec = { id: p ? p.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, date: f.date.value, start: f.start.value, end: f.end.value,
        place: f.place.value.trim(), note: f.note.value.trim(), repeat: f.repeat.value, until: f.repeat.value === "none" ? "" : f.until.value, skip: p?.skip || [] };
      if (p) prefs.personal = prefs.personal.map((x) => (x.id === p.id ? rec : x)); else prefs.personal.push(rec);
      savePrefs(); dlg.close(); renderStatic(); renderSchedule(); refreshListDialog();
    };
    $$("[data-del]", dlg).forEach((b) => (b.onclick = () => {
      if (b.dataset.del === "one" && dateStr) {
        prefs.personal = prefs.personal.map((x) => (x.id === p.id ? { ...x, skip: [...(x.skip || []), dateStr] } : x));
      } else prefs.personal = prefs.personal.filter((x) => x.id !== p.id);
      savePrefs(); dlg.close(); renderStatic(); renderSchedule(); refreshListDialog();
    }));
    showDialog(dlg);
    if (isNew) setTimeout(() => f.title.focus(), 50);
  }
  function openList() {
    const dlg = $("#dlg-list");
    const items = [...prefs.personal].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    dlg.innerHTML = `<div class="dlg">
      <div class="dlg-head"><h3>${esc(t("personalLessons"))}</h3><button type="button" class="btn icon-btn ghost" data-close aria-label="${esc(t("close"))}">${ICON.x}</button></div>
      <div class="dlg-body">
        <p class="note-muted">${esc(items.length ? t("personalWhere") : t("personalEmpty"))}</p>
        <ul class="plist">${items.map((p) => `<li><button type="button" data-p="${esc(p.id)}"><b>${esc(p.title)}</b>
          <span>${esc(repeatLabel(p))} · ${p.start}–${p.end}${p.place ? " · " + esc(p.place) : ""}</span></button></li>`).join("")}</ul>
      </div>
      <div class="dlg-foot"><button type="button" class="btn primary" data-new>${ICON.plus}<span>${esc(t("addPersonal"))}</span></button></div></div>`;
    $("[data-close]", dlg).onclick = () => dlg.close();
    $("[data-new]", dlg).onclick = () => openEdit(null, ymd(new Date()));
    $$("[data-p]", dlg).forEach((b) => (b.onclick = () => openEdit(prefs.personal.find((x) => x.id === b.dataset.p), null)));
    showDialog(dlg);
  }
  const refreshListDialog = () => { if ($("#dlg-list").open) openList(); };

  // ------------------------------------------------------------ приложения: Android и iPhone
  let installEvt = null;
  let apkAvailable = false;
  const QS = new URLSearchParams(location.search);
  const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) || QS.has("ios");
  const STANDALONE = navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const inApp = () => !!(window.Android && window.Android.saveConfig);

  function appCardsHTML() {
    if (inApp()) return "";
    const cards = [];
    const ios = `<div class="appcard"><div class="ph">${ICON.apple}</div><div class="grow"><b>${esc(t("iphoneTitle"))}</b><span>${esc(t("iphoneText"))}</span></div>
      <div class="ac-btns"><button type="button" class="btn primary" data-ios>${esc(t("iphoneBtn"))}</button></div></div>`;
    if (apkAvailable || installEvt) {
      cards.push(`<div class="appcard"><div class="ph">${ICON.android}</div><div class="grow"><b>${esc(t("androidTitle"))}</b><span>${esc(t("androidText"))}</span></div>
        <div class="ac-btns">${apkAvailable ? `<a class="btn primary" href="app/raspisanie.apk" download>${esc(t("download"))}</a>` : ""}
        ${installEvt ? `<button type="button" class="btn" data-install>${esc(t("install"))}</button>` : ""}</div></div>`);
    }
    if (IS_IOS) cards.unshift(ios); else cards.push(ios);
    return `<div class="apps">${cards.join("")}</div>`;
  }

  function renderFoot() {
    const gen = new Date(D.generated);
    const genStr = L() === "zh" ? `${gen.getMonth() + 1}月${gen.getDate()}日 ${pad(gen.getHours())}:${pad(gen.getMinutes())}` : `${fmtDM(gen)}, ${pad(gen.getHours())}:${pad(gen.getMinutes())}`;
    $("#foot").innerHTML = `${appCardsHTML()}
      <details><summary>${esc(t("sources", D.sources.length))} · ${esc(t("updated", genStr))}</summary>
        <ul>${D.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(trProgram(s))} — ${esc(trCourse(s))}</a>${s.updated ? " · " + esc(fmtIso(s.updated)) : ""}</li>`).join("")}</ul>
      </details>
      <p>${esc(t("disclaimer"))}</p>`;
    const ib = $("[data-install]", $("#foot"));
    if (ib) ib.onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderFoot(); };
    $$("[data-ios]", $("#foot")).forEach((b) => (b.onclick = openIOS));
    renderBanner();
  }

  // на iPhone в Safari — заметная кнопка установки вверху страницы
  function renderBanner() {
    const box = $("#banner");
    if (!IS_IOS || STANDALONE || inApp() || prefs.iosBannerClosed) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="banner"><div class="ph">${ICON.apple}</div>
      <div class="grow"><b>${esc(t("iosBanner"))}</b><span>${esc(t("iosBannerText"))}</span></div>
      <button type="button" class="btn primary" data-ios>${esc(t("howTo"))}</button>
      <button type="button" class="btn icon-btn ghost" data-hide aria-label="${esc(t("close"))}">${ICON.x}</button></div>`;
    $("[data-ios]", box).onclick = openIOS;
    $("[data-hide]", box).onclick = () => { prefs.iosBannerClosed = true; savePrefs(); renderBanner(); };
  }

  // настройки для виджетов: группа, язык, личные занятия и переводы названий
  function widgetConfig() {
    const key = prefs.myGroup || prefs.group;
    const g = key && idx.groupByKey[key];
    const tr = {};
    if (g && L() === "zh") {
      (idx.byGroup[g.id] || []).forEach((l) => {
        tr[l.subject] = trSubject(l.subject);
        l.rooms.forEach((r) => (tr[r] = trRoom(r)));
      });
    }
    return {
      site: new URL(".", location.href).href,
      dataUrl: new URL("data/schedule.json", location.href).href,
      groupKey: g ? g.key : null,
      groupTitle: g ? `${trGroup(g.name)} · ${shortSource(idx.source[g.source])}` : "",
      lang: L(),
      personal: prefs.personal,
      tr,
    };
  }
  function pushToAndroid() {
    if (!D || !inApp()) return;
    try { window.Android.saveConfig(JSON.stringify(widgetConfig())); } catch { /* старая версия приложения */ }
  }

  // Копирование в буфер: сначала через выделение (надёжно в Safari на iPhone), потом Clipboard API.
  // Временное поле кладём внутрь открытого диалога — всё вне модального окна недоступно.
  function copyText(text, host) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.contentEditable = "true";
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px";
    host.appendChild(ta);
    const range = document.createRange();
    range.selectNodeContents(ta);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    sel.removeAllRanges();
    if (ok) return Promise.resolve();
    return navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error("no clipboard"));
  }

  // iPhone: приложение на экран «Домой» + виджет через Scriptable
  let widgetTemplate = null;
  async function openIOS() {
    const dlg = $("#dlg-item");
    const cfg = widgetConfig();
    // шаблон скачиваем заранее: Safari разрешает копирование только сразу после нажатия
    try { widgetTemplate ||= await (await fetch("ios/widget.js", { cache: "no-cache" })).text(); } catch { widgetTemplate = null; }
    const code = widgetTemplate ? widgetTemplate.replace("/*CONFIG*/{}", JSON.stringify(cfg, null, 1)) : "";
    const ready = !!code && !!(cfg.groupKey || cfg.personal.length);
    const steps = (arr) => `<ol class="steps">${arr.map((x) => `<li>${esc(x)
      .replace("{share}", `<span class="ios-ico">${ICON.share}</span>`)
      .replace("{scriptable}", `<a href="https://scriptable.app/" target="_blank" rel="noopener">Scriptable</a>`)}</li>`).join("")}</ol>`;
    const siteUrl = location.href.split("#")[0].split("?")[0];
    dlg.innerHTML = `<div class="dlg">
      <div class="dlg-head"><h3>${esc(t("iosDlgTitle"))}</h3><button type="button" class="btn icon-btn ghost" data-close aria-label="${esc(t("close"))}">${ICON.x}</button></div>
      <div class="dlg-body">
        <h4>${esc(t("iosStep1Title"))}</h4>
        ${steps(t("iosSteps1"))}
        <p class="note-muted">${esc(t("iosStep1Note"))}</p>
        ${IS_IOS ? "" : `<p class="note-muted">${esc(t("iosOpenOnPhone"))} <b class="url">${esc(siteUrl)}</b></p>`}
        <h4>${esc(t("iosStep2Title"))}</h4>
        ${steps(t("iosSteps2"))}
        ${cfg.groupKey ? `<p class="note-muted">${esc(t("iosScriptFor"))} <b>${esc(cfg.groupTitle)}</b>. ${esc(t("scriptPersonalNote"))}</p>`
          : `<p class="warn">${esc(t("scriptNeedsGroup"))}</p>`}
        <textarea class="code" readonly hidden aria-label="Scriptable"></textarea>
      </div>
      <div class="dlg-foot">
        <button type="button" class="btn" data-close>${esc(t("close"))}</button>
        <button type="button" class="btn primary" data-copy ${ready ? "" : "disabled"}>${esc(t("copyScript"))}</button>
      </div></div>`;
    $$("[data-close]", dlg).forEach((b) => (b.onclick = () => dlg.close()));
    $("[data-copy]", dlg).onclick = () => {
      const ta = $("textarea.code", dlg);
      const fallback = () => { ta.hidden = false; ta.value = code; ta.focus(); ta.select(); toast(t("copyFail"), 6000); };
      copyText(code, dlg).then(() => toast(t("copied"), 5000), fallback);
    };
    showDialog(dlg);
  }

  // ------------------------------------------------------------ сборка страницы
  function renderAll() {
    renderStatic();
    renderTitle();
    renderSchedule();
    renderFoot();
  }
  function update() {
    renderControls();
    renderAll();
    remember();
  }

  function toast(msg, ms = 3500) {
    const el = $("#toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t);
    if (ms) toast.t = setTimeout(() => (el.hidden = true), ms);
  }

  async function localRefresh() {
    const b = $("#btn-refresh");
    b.disabled = true; b.classList.add("spin");
    toast(t("refreshStart"), 0);
    try {
      const r = await fetch("api/refresh", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      const gk = st.groupId && idx.group[st.groupId].key;
      setData(j);
      if (!selectGroupKey(gk)) { st.groupId = null; }
      update();
      toast(t("refreshDone", j.groups.length, j.teachers.length));
    } catch (e) {
      toast(t("refreshFail", e.message), 6000);
    } finally { b.disabled = false; b.classList.remove("spin"); }
  }

  async function init() {
    renderStatic();
    try {
      const r = await fetch("data/schedule.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      setData(await r.json());
    } catch (e) {
      $("#schedule").innerHTML = `<div class="loading">${esc(t("noData"))}</div>`;
      return;
    }
    restoreSelection();
    $$(".langs button").forEach((b) => (b.onclick = () => { prefs.lang = b.dataset.lang; savePrefs(); update(); }));
    $("#btn-personal").onclick = openList;
    $("#btn-refresh").onclick = localRefresh;
    DESKTOP.addEventListener("change", () => { st.ctlOpen = DESKTOP.matches || st.ctlOpen; renderControls(); renderAll(); });
    window.addEventListener("hashchange", () => {
      const h = new URLSearchParams(location.hash.slice(1));
      if (h.get("g") && selectGroupKey(h.get("g"))) st.mode = "group";
      else if (h.get("t") && idx.byTeacher[h.get("t")]) { st.mode = "teacher"; st.teacher = h.get("t"); }
      else return;
      update();
    });
    if (DESKTOP.matches) st.ctlOpen = true;
    update();

    // «идёт сейчас»: перерисовываем раз в минуту, если что-то изменилось
    let lastNow = "";
    setInterval(() => {
      const k = new Date().getHours() * 60 + new Date().getMinutes();
      const key = Object.values(st.items).filter((it) => it.ds === ymd(new Date()) && toMin(it.start) <= k && k < toMin(it.end)).map((it) => it.id).join();
      if (key !== lastNow) { lastNow = key; if (!document.querySelector("dialog[open]")) renderSchedule(); }
    }, 60000);

    // локальный сервер умеет обновлять данные с сайта
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      fetch("api/status").then((r) => r.ok && r.json()).then((j) => { if (j && j.local) $("#btn-refresh").hidden = false; }).catch(() => {});
    }
    // APK для Android публикуется рядом с сайтом
    fetch("app/raspisanie.apk", { method: "HEAD" }).then((r) => { apkAvailable = r.ok && !/html/.test(r.headers.get("content-type") || ""); renderFoot(); }).catch(() => {});
  }

  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; if (D) renderFoot(); });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  init();
})();

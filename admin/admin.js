/* Панель учебного отдела: изменения в расписании и объявления.
   Открывается только на компьютере, где запущен app.py; публикует ленту site/data/feed.json на GitHub. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const Z = window.I18N.zh;
  const DAYS = window.I18N.days.ru, DAYS_SHORT = window.I18N.daysShort.ru, DAYS_ZH = window.I18N.days.zh;
  const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const REASONS = Object.keys(Z.reasons); // типовые причины — у них есть перевод на китайский
  const X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  const NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

  // ------------------------------------------------------------ даты
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dow = (s) => (parseYmd(s).getDay() + 6) % 7;
  const today = () => ymd(new Date());
  function calendarMonday() { const n = new Date(); n.setHours(0, 0, 0, 0); return addDays(n, -((n.getDay() + 6) % 7)); }
  const fmtDM = (s) => { const d = parseYmd(s); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`; };
  const fmtShort = (s) => { const d = parseYmd(s); return `${DAYS_SHORT[dow(s)].toLowerCase()} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
  const fmtDay = (s) => `${DAYS[dow(s)].toLowerCase()}, ${fmtDM(s)}`;
  const fmtZh = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}月${d.getDate()}日（${DAYS_ZH[dow(s)]}）`; };
  const fmtTime = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  // ------------------------------------------------------------ состояние
  const VIEW_LS = "rasp.admin.view", DRAFT_LS = "rasp.admin.draft";
  const readLS = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* недоступно */ } };
  const S = Object.assign({ mode: "group", sourceId: null, groupId: null, teacher: "", week: 0, tab: "edit" }, readLS(VIEW_LS) || {});
  let D = null, idx = {};
  let feed = { rev: 0, changes: [], notices: [] };
  let pub = { github: false };
  let busy = false, pubError = "";
  const emptyDraft = () => ({ changes: [], notice: { send: true, all: false, groups: [], title: "", body: "", title_zh: "", body_zh: "", touched: {} } });
  let draft = Object.assign(emptyDraft(), readLS(DRAFT_LS) || {});
  const saveView = () => writeLS(VIEW_LS, { mode: S.mode, sourceId: S.sourceId, groupId: S.groupId, teacher: S.teacher, week: S.week, tab: S.tab });
  const saveDraft = () => writeLS(DRAFT_LS, draft);

  function setData(data) {
    D = data;
    idx = { source: {}, group: {}, groupByKey: {}, byGroup: {}, byTeacher: {}, byKey: {} };
    D.sources.forEach((s) => (idx.source[s.id] = s));
    D.groups.forEach((g) => { idx.group[g.id] = g; idx.groupByKey[g.key] = g; });
    D.lessons.forEach((l) => {
      if (l.key) idx.byKey[l.key] = l;
      l.groups.forEach((g) => (idx.byGroup[g] ||= []).push(l));
      l.teachers.forEach((x) => (idx.byTeacher[x] ||= []).push(l));
    });
    const fill = (id, list) => ($("#" + id).innerHTML = [...new Set(list)].sort((a, b) => a.localeCompare(b, "ru")).map((x) => `<option value="${esc(x)}">`).join(""));
    fill("dl-teachers", D.teachers);
    fill("dl-rooms", D.lessons.flatMap((l) => l.rooms));
    fill("dl-subjects", D.lessons.map((l) => l.subject));
  }

  // изменения: опубликованные и из черновика, по занятию и дате
  function changeIndex(list) {
    const occ = new Map(), extra = [];
    list.forEach((c) => {
      if (c.type === "add") extra.push(c);
      else {
        occ.set(c.lesson + "@" + c.date, c);
        if (c.type === "change" && isMove(c)) extra.push(c);
      }
    });
    return { occ, extra };
  }
  const isMove = (c) => c.type === "change" && (c.to.date !== c.date || c.to.start !== c.start || c.to.end !== c.end);
  const upcoming = (c) => (c.type === "change" && c.to.date > c.date ? c.to.date : c.date) >= today();

  // ------------------------------------------------------------ подписи
  function shortSource(s) {
    const lv = { "Колледж (СПО)": "СПО", "Бакалавриат и специалитет": "Бак./спец.", "Магистратура": "Магистратура", "Аспирантура": "Аспирантура", "Ассистентура-стажировка": "Ассистентура" }[s.level] || s.level;
    return lv + (s.course ? `, ${s.course} курс` : "") + (s.foreign ? " (ин.)" : "");
  }
  function groupsBrief(keys) {
    const bySrc = new Map();
    let unknown = 0;
    keys.forEach((k) => {
      const g = idx.groupByKey[k];
      if (!g) { unknown++; return; }
      if (!bySrc.has(g.source)) bySrc.set(g.source, []);
      bySrc.get(g.source).push(g);
    });
    const parts = [...bySrc.entries()].map(([sid, gs]) => {
      const s = shortSource(idx.source[sid]);
      return gs.length <= 2 ? `${s}: ${gs.map((g) => g.name).join(", ")}` : `${s} · ${gs.length} ${plural(gs.length, "направление", "направления", "направлений")}`;
    });
    if (unknown) parts.push(`ещё ${unknown} (нет в текущем расписании)`);
    return parts.join("; ");
  }
  const groupKeys = (l) => l.groups.map((id) => idx.group[id]?.key).filter(Boolean);
  const lower1 = (s) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);
  const list = (a) => (a && a.length ? a.join(", ") : "");
  const TAG = { cancel: ["Отменено", "off"], moved: ["Перенесено", "chg"], changed: ["Изменено", "chg"], add: ["Доп. занятие", "add"], movedIn: ["Перенос сюда", "chg"] };
  const kindOf = (c) => (c.type === "cancel" ? "cancel" : c.type === "add" ? "add" : isMove(c) ? "moved" : "changed");

  // что именно поменялось — одной строкой
  function changeDetails(c) {
    const parts = [];
    if (c.type === "change") {
      if (isMove(c)) parts.push(`на ${fmtShort(c.to.date)}, ${c.to.start}–${c.to.end}`);
      if (list(c.to.teachers) !== list(c.teachers)) parts.push(`ведёт ${list(c.to.teachers) || "—"}`);
      if (list(c.to.rooms) !== list(c.rooms)) parts.push(`ауд.: ${list(c.to.rooms) || "—"}`);
    }
    if (c.note) parts.push(c.note);
    return parts.join(" · ");
  }

  // ------------------------------------------------------------ тексты объявления
  function trSubjectZh(s) {
    if (Z.subjects[s]) return Z.subjects[s];
    const m = s.match(/^(.*?)\s*\(([^)]+)\)$/);
    if (m && Z.subjects[m[1]]) return `${Z.subjects[m[1]]}（${Z.suffixes[m[2]] || m[2]}）`;
    return s;
  }
  const trRoomZh = (r) => Z.rooms[r] || r.replace(/^Каб\.\s*/, "教室 ");

  function sentenceRu(c) {
    const who = list(c.teachers) ? ` (${list(c.teachers)})` : "";
    const when = `${fmtDay(c.date)}, ${c.start}–${c.end}`;
    const why = c.note ? ` Причина: ${lower1(c.note)}.` : "";
    if (c.type === "add") return `Дополнительное занятие: ${c.subject}${who} — ${when}${list(c.rooms) ? ", " + list(c.rooms) : ""}.${why}`;
    if (c.type === "cancel") return `${c.subject}${who}, ${when} — занятие отменено.${why}`;
    const what = [];
    if (isMove(c)) what.push(`перенесено на ${fmtDay(c.to.date)}, ${c.to.start}–${c.to.end}`);
    if (list(c.to.teachers) !== list(c.teachers)) what.push(`ведёт ${list(c.to.teachers) || "—"}`);
    if (list(c.to.rooms) !== list(c.rooms)) what.push(`аудитория: ${list(c.to.rooms) || "уточняется"}`);
    return `${c.subject}${who}, ${when} — ${what.join(", ")}.${why}`;
  }
  function sentenceZh(c) {
    const subj = trSubjectZh(c.subject);
    const when = `${fmtZh(c.date)} ${c.start}–${c.end}`;
    const why = c.note ? `原因：${Z.reasons[c.note] || c.note}。` : "";
    const rooms = (a) => a.map(trRoomZh).join("、");
    if (c.type === "add") return `加课：${subj}，${when}${c.rooms.length ? "，" + rooms(c.rooms) : ""}。${why}`;
    if (c.type === "cancel") return `${subj}，${when}：停课。${why}`;
    const what = [];
    if (isMove(c)) what.push(`改至${fmtZh(c.to.date)} ${c.to.start}–${c.to.end}`);
    if (list(c.to.teachers) !== list(c.teachers)) what.push(`任课教师：${list(c.to.teachers) || "—"}`);
    if (list(c.to.rooms) !== list(c.rooms)) what.push(`教室：${rooms(c.to.rooms) || "待定"}`);
    return `${subj}，${when}：${what.join("，")}。${why}`;
  }
  function autoNotice() {
    const cs = draft.changes;
    if (!cs.length) return { title: "", body: "", title_zh: "", body_zh: "" };
    const one = cs.length === 1 ? kindOf(cs[0]) : null;
    const titles = { cancel: ["Отмена занятия", "停课通知"], moved: ["Перенос занятия", "调课通知"], changed: ["Изменение в расписании", "课表变更"], add: ["Дополнительное занятие", "加课通知"] };
    const [title, title_zh] = titles[one] || ["Изменения в расписании", "课表变更"];
    const sorted = [...cs].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    return { title, title_zh, body: sorted.map(sentenceRu).join("\n"), body_zh: sorted.map(sentenceZh).join("\n") };
  }
  function noticeGroups() {
    const keys = new Set(draft.notice.groups);
    draft.changes.forEach((c) => c.groups.forEach((k) => keys.add(k)));
    return [...keys];
  }

  // ------------------------------------------------------------ сеть
  async function api(path, body) {
    const opts = body === undefined ? { cache: "no-store" }
      : { method: "POST", headers: { "Content-Type": "application/json", "X-Rasp": "1" }, body: JSON.stringify(body) };
    let r;
    try { r = await fetch("/api/admin/" + path, opts); } catch { throw new Error("Программа расписания не отвечает. Запустите её снова (ярлык «Учебный отдел»)."); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Ошибка ${r.status}`);
    return j;
  }
  function toast(msg, ms = 4000) {
    const el = $("#toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t);
    if (ms) toast.t = setTimeout(() => (el.hidden = true), ms);
  }

  // ------------------------------------------------------------ шапка: состояние публикации
  function renderStatus() {
    const box = $("#status");
    $("#site-link").href = pub.site || "/";
    if (!pub.github) {
      box.innerHTML = `<div class="warn st">Публикация на сайт не настроена: изменения сохранятся только на этом компьютере.
        Чтобы настроить, запустите «Настроить публикацию» в папке программы (или команду <code>python app.py github</code>).</div>`;
    } else if (pub.error) {
      box.innerHTML = `<div class="warn st"><b>Нет связи с сайтом.</b> ${esc(pub.error)}</div>`;
    } else box.innerHTML = "";
    const n = feed.changes.filter(upcoming).length + feed.notices.length;
    $("#pub-count").hidden = !n;
    $("#pub-count").textContent = n;
    $$(".tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === S.tab)));
  }

  // ------------------------------------------------------------ выбор группы или преподавателя
  function controlsHTML() {
    const seg = `<div class="seg" role="group">
      <button type="button" data-mode="group" aria-pressed="${S.mode === "group"}">Группа</button>
      <button type="button" data-mode="teacher" aria-pressed="${S.mode === "teacher"}">Преподаватель</button></div>`;
    if (S.mode === "teacher") {
      return `<section class="controls open"><div class="ctl-body">${seg}
        <label class="field f-teacher"><span>Преподаватель</span><input type="search" id="teacher" list="dl-teachers" placeholder="Начните вводить фамилию…" value="${esc(S.teacher)}" autocomplete="off"></label>
      </div></section>`;
    }
    const programs = [];
    D.sources.forEach((s) => {
      let pg = programs.find((x) => x.key === s.program);
      if (!pg) programs.push((pg = { key: s.program, items: [] }));
      pg.items.push(s);
    });
    const opts = programs.map((pg) => `<optgroup label="${esc(pg.key)}">${pg.items.map((s) =>
      `<option value="${s.id}"${s.id === S.sourceId ? " selected" : ""}>${esc(s.program)} — ${esc(s.courseLabel || "все курсы")}</option>`).join("")}</optgroup>`).join("");
    const gs = D.groups.filter((g) => g.source === S.sourceId);
    const gopts = (S.groupId && idx.group[S.groupId]?.source === S.sourceId ? "" : `<option value="" selected disabled>—</option>`) +
      gs.map((g) => `<option value="${g.id}"${g.id === S.groupId ? " selected" : ""}>${esc(g.name)}</option>`).join("");
    return `<section class="controls open"><div class="ctl-body">${seg}
      <label class="field f-program"><span>Программа и курс</span><select id="sel-src">${opts}</select></label>
      <label class="field f-group"><span>Направление</span><select id="sel-group">${gopts}</select></label>
    </div></section>`;
  }
  function bindControls(root) {
    $$("[data-mode]", root).forEach((b) => (b.onclick = () => { S.mode = b.dataset.mode; saveView(); render(); if (S.mode === "teacher") $("#teacher")?.focus(); }));
    const src = $("#sel-src", root), grp = $("#sel-group", root), tch = $("#teacher", root);
    if (src) src.onchange = () => { S.sourceId = src.value; S.groupId = null; saveView(); render(); };
    if (grp) grp.onchange = () => { S.groupId = grp.value; saveView(); render(); };
    if (tch) tch.onchange = tch.oninput = () => {
      if (idx.byTeacher[tch.value] && tch.value !== S.teacher) { S.teacher = tch.value; saveView(); render(); $("#teacher")?.blur(); }
    };
  }

  // ------------------------------------------------------------ неделя
  const viewLessons = () => (S.mode === "group" ? (S.groupId && idx.byGroup[S.groupId]) || [] : idx.byTeacher[S.teacher] || []);
  const viewKey = () => (S.mode === "group" && S.groupId ? idx.group[S.groupId].key : null);
  function inView(c) {
    if (S.mode === "group") return !!viewKey() && c.groups.includes(viewKey());
    const t = c.type === "change" ? c.to.teachers : c.teachers;
    return t.includes(S.teacher);
  }
  // занятие по снимку из изменения (если его уже нет в расписании)
  const snapshot = (c) => ({ key: c.lesson, start: c.start, end: c.end, subject: c.subject, teachers: c.teachers, rooms: c.rooms, groups: [], keys: c.groups });

  function weekDays() {
    const mon = addDays(calendarMonday(), S.week * 7);
    const lessons = viewLessons();
    const P = changeIndex(feed.changes), Dr = changeIndex(draft.changes);
    return [0, 1, 2, 3, 4, 5, 6].map((di) => {
      const ds = ymd(addDays(mon, di));
      const rows = [];
      lessons.filter((l) => l.day === di).forEach((l) => {
        const k = l.key + "@" + ds;
        rows.push({ l, ds, start: l.start, end: l.end, d: Dr.occ.get(k), p: P.occ.get(k) });
      });
      // перенесённые сюда и дополнительные занятия
      [[P.extra, "p"], [Dr.extra, "d"]].forEach(([arr, src]) => arr.forEach((c) => {
        const target = c.type === "add" ? c.date : c.to.date;
        if (target !== ds || !inView(c)) return;
        const l = (c.lesson && idx.byKey[c.lesson]) || snapshot(c);
        const start = c.type === "add" ? c.start : c.to.start, end = c.type === "add" ? c.end : c.to.end;
        rows.push({ l, ds, start, end, extra: c, src });
      }));
      rows.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
      return { di, ds, rows };
    });
  }

  function weekHTML() {
    if (S.mode === "group" ? !S.groupId : !idx.byTeacher[S.teacher]) {
      return `<div class="empty-box">${S.mode === "group" ? "Выберите программу, курс и направление — появится расписание группы на неделю." : "Выберите преподавателя — появятся его занятия на неделю."}</div>`;
    }
    const days = weekDays();
    const mon = days[0].ds, sat = days[days[6].rows.length ? 6 : 5].ds;
    const head = `<div class="weekbar adm-wb"><div class="wb-main">
      <button type="button" class="btn icon-btn" data-w="-1" aria-label="Предыдущая неделя">${PREV}</button>
      <div class="wb-range"><b>${esc(fmtDM(mon))} – ${esc(fmtDM(sat))}</b><span>${S.week === 0 ? "эта неделя" : S.week === 1 ? "следующая неделя" : ""}</span></div>
      <button type="button" class="btn icon-btn" data-w="1" aria-label="Следующая неделя">${NEXT}</button>
      <div class="wb-spacer"></div>
      ${S.week ? `<button type="button" class="btn" data-w="0">Эта неделя</button>` : ""}
    </div></div>`;
    return head + days.filter((d) => d.di < 6 || d.rows.length).map((d) => {
      const past = d.ds < today();
      const cancellable = d.rows.filter((r) => !r.extra && !r.d && !r.p).length;
      return `<section class="aday${past ? " past" : ""}${d.ds === today() ? " today" : ""}">
        <header><h3>${esc(DAYS[d.di])}<small>${esc(fmtDM(d.ds))}${d.ds === today() ? " · сегодня" : ""}</small></h3>
          <div class="aday-act">
            ${cancellable > 1 ? `<button type="button" class="btn" data-cancel-day="${d.ds}">Отменить все…</button>` : ""}
            ${S.mode === "group" ? `<button type="button" class="btn" data-add="${d.ds}">+ Доп. занятие</button>` : ""}
          </div></header>
        ${d.rows.length ? `<ul class="arows">${d.rows.map(rowHTML).join("")}</ul>` : `<p class="fnone">Нет занятий</p>`}
      </section>`;
    }).join("");
  }

  let rowSeq = 0;
  const rowRefs = new Map();
  function rowHTML(r) {
    const id = "r" + ++rowSeq;
    rowRefs.set(id, r);
    const l = r.l;
    let tag = "", info = "", acts = "", cls = "";
    if (r.extra) {
      const c = r.extra, k = c.type === "add" ? "add" : "movedIn";
      tag = tagHTML(TAG[k], r.src === "d");
      info = c.type === "add" ? c.note : [`перенесено с ${fmtShort(c.date)}, ${c.start}`, c.note].filter(Boolean).join(" · ");
      acts = r.src === "d" ? `<button type="button" class="btn" data-unDraft="${esc(c.uid)}">Убрать из черновика</button>`
        : `<button type="button" class="btn" data-revert="${esc(c.id)}">Вернуть как было</button>`;
      cls = TAG[k][1];
    } else if (r.d) {
      tag = tagHTML(TAG[kindOf(r.d)], true);
      info = changeDetails(r.d);
      acts = `<button type="button" class="btn" data-edit="${id}">Изменить…</button><button type="button" class="btn" data-unDraft="${esc(r.d.uid)}">Убрать из черновика</button>`;
      cls = TAG[kindOf(r.d)][1] + " draft";
    } else if (r.p) {
      tag = tagHTML(TAG[kindOf(r.p)], false);
      info = changeDetails(r.p);
      acts = `<button type="button" class="btn" data-edit="${id}">Изменить…</button><button type="button" class="btn" data-revert="${esc(r.p.id)}">Вернуть как было</button>`;
      cls = TAG[kindOf(r.p)][1];
    } else {
      acts = `<button type="button" class="btn" data-cancel="${id}">Отменить…</button><button type="button" class="btn" data-edit="${id}">Перенести или заменить…</button>`;
    }
    const teachers = r.extra && r.extra.type === "change" ? r.extra.to.teachers : l.teachers;
    const rooms = r.extra && r.extra.type === "change" ? r.extra.to.rooms : l.rooms;
    const keys = l.keys || groupKeys(l);
    const groups = S.mode === "teacher" || keys.length > 1 ? `<div class="r-groups">${keys.length > 1 && S.mode === "group" ? "Совместно: " : ""}${esc(groupsBrief(keys))}</div>` : "";
    const struck = (r.d || r.p) && ["cancel", "moved"].includes(kindOf(r.d || r.p));
    return `<li class="arow ${cls}${struck ? " struck" : ""}">
      <div class="r-time"><b>${r.start}</b><span>${r.end}</span></div>
      <div class="r-main">
        <div class="r-title">${esc(l.subject)}</div>
        <div class="r-meta">${esc([list(teachers), list(rooms)].filter(Boolean).join(" · "))}</div>
        ${groups}
        ${tag || info ? `<div class="r-state">${tag}${info ? `<span>${esc(info)}</span>` : ""}</div>` : ""}
      </div>
      <div class="r-act">${acts}</div>
    </li>`;
  }
  const tagHTML = ([label, cls], isDraft) => `<span class="tag ${cls}">${esc(label)}</span>${isDraft ? `<span class="tag draft">черновик</span>` : ""}`;

  function bindWeek(root) {
    $$("[data-w]", root).forEach((b) => (b.onclick = () => { const w = +b.dataset.w; S.week = w === 0 ? 0 : S.week + w; saveView(); render(); }));
    $$("[data-cancel]", root).forEach((b) => (b.onclick = () => { const r = rowRefs.get(b.dataset.cancel); openLesson(r.l, r.ds, "cancel", null); }));
    $$("[data-edit]", root).forEach((b) => (b.onclick = () => { const r = rowRefs.get(b.dataset.edit); const c = r.d || r.p; openLesson(r.l, r.ds, c ? c.type : "change", c); }));
    $$("[data-undraft]", root).forEach((b) => (b.onclick = () => removeDraft(b.dataset.undraft)));
    $$("[data-revert]", root).forEach((b) => (b.onclick = () => revert(b.dataset.revert)));
    $$("[data-add]", root).forEach((b) => (b.onclick = () => openAdd(b.dataset.add)));
    $$("[data-cancel-day]", root).forEach((b) => (b.onclick = () => openCancelDay(b.dataset.cancelDay)));
  }

  // ------------------------------------------------------------ диалоги
  function showDialog(html, onSubmit) {
    const dlg = $("#dlg");
    dlg.innerHTML = `<form class="dlg" method="dialog" novalidate>${html}</form>`;
    const f = $("form", dlg);
    $$("[data-close]", dlg).forEach((b) => (b.onclick = () => dlg.close()));
    f.onsubmit = (e) => {
      e.preventDefault();
      const err = $(".err", dlg);
      try {
        onSubmit(f);
        dlg.close();
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
      }
    };
    dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
    if (!dlg.open) dlg.showModal();
    return f;
  }
  const head = (title) => `<div class="dlg-head"><h3>${esc(title)}</h3><button type="button" class="btn icon-btn ghost" data-close aria-label="Закрыть">${X}</button></div>`;
  const foot = (label) => `<div class="dlg-foot"><button type="button" class="btn" data-close>Отмена</button><button type="submit" class="btn primary">${esc(label)}</button></div>`;
  function reasonHTML(note) {
    const known = !note || REASONS.includes(note);
    return `<label class="field full"><span>Причина (увидят студенты)</span><select name="reason">
        <option value="">— не указывать —</option>
        ${REASONS.map((r) => `<option${r === note ? " selected" : ""}>${esc(r)}</option>`).join("")}
        <option value="*"${known ? "" : " selected"}>Другая причина…</option></select></label>
      <label class="field full" data-other ${known ? "hidden" : ""}><span>Своими словами</span><input type="text" name="other" maxlength="300" value="${esc(known ? "" : note)}"></label>`;
  }
  function bindReason(f) {
    const sync = () => { $("[data-other]", f).hidden = f.reason.value !== "*"; };
    f.reason.onchange = () => { sync(); if (f.reason.value === "*") f.other.focus(); };
  }
  const readReason = (f) => (f.reason.value === "*" ? f.other.value.trim() : f.reason.value);
  const splitList = (s) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  function lessonCard(l, ds) {
    const keys = l.keys || groupKeys(l);
    return `<div class="lcard"><b>${esc(l.subject)}</b>
      <span>${esc(DAYS[dow(ds)])}, ${esc(fmtDM(ds))} · ${l.start}–${l.end}</span>
      ${list(l.teachers) || list(l.rooms) ? `<span>${esc([list(l.teachers), list(l.rooms)].filter(Boolean).join(" · "))}</span>` : ""}
      <span class="muted">Группы: ${esc(groupsBrief(keys))}</span></div>`;
  }

  // отмена или перенос одного занятия
  function openLesson(l, ds, type, existing) {
    const to = existing && existing.type === "change" ? existing.to : { date: ds, start: l.start, end: l.end, teachers: l.teachers, rooms: l.rooms };
    const f = showDialog(`${head("Изменение занятия")}
      <div class="dlg-body">
        ${lessonCard(l, ds)}
        <div class="seg kind" role="group">
          <button type="button" data-kind="cancel" aria-pressed="${type === "cancel"}">Отменить</button>
          <button type="button" data-kind="change" aria-pressed="${type !== "cancel"}">Перенести или заменить</button>
        </div>
        <input type="hidden" name="kind" value="${type === "cancel" ? "cancel" : "change"}">
        <div class="form">
          <div class="form full" data-for="change" ${type === "cancel" ? "hidden" : ""}>
            <label class="field full"><span>Дата</span><input type="date" name="date" value="${esc(to.date)}" required></label>
            <label class="field"><span>Начало</span><input type="time" name="start" step="60" value="${esc(to.start)}" required></label>
            <label class="field"><span>Конец</span><input type="time" name="end" step="60" value="${esc(to.end)}" required></label>
            <label class="field full"><span>Преподаватель (несколько — через запятую)</span><input type="text" name="teachers" list="dl-teachers" value="${esc(list(to.teachers))}"></label>
            <label class="field full"><span>Аудитория</span><input type="text" name="rooms" list="dl-rooms" value="${esc(list(to.rooms))}"></label>
          </div>
          ${reasonHTML(existing ? existing.note : "")}
          <div class="err" hidden></div>
        </div>
      </div>${foot("В черновик")}`, (f) => {
      const base = { type: f.kind.value, lesson: l.key, date: ds, start: l.start, end: l.end, subject: l.subject,
        teachers: l.teachers, rooms: l.rooms, groups: l.keys || groupKeys(l), note: readReason(f) };
      if (base.type === "change") {
        if (!f.date.value || !f.start.value || !f.end.value) throw new Error("Укажите дату и время");
        if (f.end.value <= f.start.value) throw new Error("Время окончания должно быть позже начала");
        base.to = { date: f.date.value, start: f.start.value, end: f.end.value, teachers: splitList(f.teachers.value), rooms: splitList(f.rooms.value) };
        if (base.to.date === ds && base.to.start === l.start && base.to.end === l.end && list(base.to.teachers) === list(l.teachers) && list(base.to.rooms) === list(l.rooms))
          throw new Error("Ничего не изменилось: поменяйте дату, время, преподавателя или аудиторию");
      }
      addDraft(base);
    });
    bindReason(f);
    $$("[data-kind]", f).forEach((b) => (b.onclick = () => {
      f.kind.value = b.dataset.kind;
      $$("[data-kind]", f).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      $("[data-for=change]", f).hidden = b.dataset.kind !== "change";
    }));
  }

  // дополнительное занятие для группы
  function openAdd(ds) {
    const g = idx.group[S.groupId];
    const same = D.groups.filter((x) => x.source === g.source);
    const f = showDialog(`${head("Дополнительное занятие")}
      <div class="dlg-body"><div class="form">
        <label class="field full"><span>Дисциплина</span><input type="text" name="subject" list="dl-subjects" required maxlength="200"></label>
        <label class="field full"><span>Дата</span><input type="date" name="date" value="${esc(ds)}" required></label>
        <label class="field"><span>Начало</span><input type="time" name="start" step="60" value="10:00" required></label>
        <label class="field"><span>Конец</span><input type="time" name="end" step="60" value="11:30" required></label>
        <label class="field full"><span>Преподаватель (несколько — через запятую)</span><input type="text" name="teachers" list="dl-teachers"></label>
        <label class="field full"><span>Аудитория</span><input type="text" name="rooms" list="dl-rooms"></label>
        <fieldset class="field full gpick"><span>Для групп — ${esc(shortSource(idx.source[g.source]))}</span>
          ${same.map((x) => `<label class="chk"><input type="checkbox" name="g" value="${esc(x.key)}"${x.id === g.id ? " checked" : ""}>${esc(x.name)}</label>`).join("")}
        </fieldset>
        <label class="field full"><span>Комментарий для студентов (необязательно)</span><input type="text" name="note" maxlength="300"></label>
        <div class="err" hidden></div>
      </div></div>${foot("В черновик")}`, (f) => {
      if (!f.subject.value.trim()) throw new Error("Укажите дисциплину");
      if (!f.date.value || !f.start.value || !f.end.value) throw new Error("Укажите дату и время");
      if (f.end.value <= f.start.value) throw new Error("Время окончания должно быть позже начала");
      const groups = $$("input[name=g]:checked", f).map((x) => x.value);
      if (!groups.length) throw new Error("Отметьте хотя бы одну группу");
      addDraft({ type: "add", lesson: "", date: f.date.value, start: f.start.value, end: f.end.value, subject: f.subject.value.trim(),
        teachers: splitList(f.teachers.value), rooms: splitList(f.rooms.value), groups, note: f.note.value.trim() });
    });
    setTimeout(() => f.subject.focus(), 50);
  }

  // отмена всех занятий дня (болезнь преподавателя, праздник)
  function openCancelDay(ds) {
    const day = weekDays().find((d) => d.ds === ds);
    const rows = day.rows.filter((r) => !r.extra && !r.d && !r.p); // уже изменённые правят по одному
    const f = showDialog(`${head(`Отменить занятия: ${DAYS[dow(ds)].toLowerCase()}, ${fmtDM(ds)}`)}
      <div class="dlg-body"><div class="form">
        <fieldset class="field full gpick"><span>Какие занятия</span>
          ${rows.map((r, i) => `<label class="chk"><input type="checkbox" name="l" value="${i}" checked>${r.start}–${r.end} · ${esc(r.l.subject)}${list(r.l.teachers) ? ` <span class="muted">(${esc(list(r.l.teachers))})</span>` : ""}</label>`).join("")}
        </fieldset>
        ${reasonHTML("")}
        <div class="err" hidden></div>
      </div></div>${foot("В черновик")}`, (f) => {
      const picked = $$("input[name=l]:checked", f).map((x) => rows[+x.value]);
      if (!picked.length) throw new Error("Отметьте занятия");
      const note = readReason(f);
      picked.forEach((r) => addDraft({ type: "cancel", lesson: r.l.key, date: ds, start: r.l.start, end: r.l.end, subject: r.l.subject,
        teachers: r.l.teachers, rooms: r.l.rooms, groups: r.l.keys || groupKeys(r.l), note }, true));
      renderAll();
    });
    bindReason(f);
  }

  // ------------------------------------------------------------ черновик
  function addDraft(c, quiet) {
    c.uid = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    // то же занятие в ту же дату — заменяем
    draft.changes = draft.changes.filter((x) => !(c.lesson && x.lesson === c.lesson && x.date === c.date));
    draft.changes.push(c);
    saveDraft();
    if (!quiet) renderAll();
  }
  function removeDraft(uid) {
    draft.changes = draft.changes.filter((x) => x.uid !== uid);
    saveDraft(); renderAll();
  }

  function renderDraft() {
    const box = $("#draft");
    const n = draft.notice, cs = [...draft.changes].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    const auto = autoNotice();
    ["title", "body", "title_zh", "body_zh"].forEach((k) => { if (!n.touched[k]) n[k] = auto[k]; });
    const groups = noticeGroups();
    const openKey = viewKey();
    const canAddOpen = openKey && !groups.includes(openKey);
    const hasRecip = n.all || groups.length;
    box.innerHTML = `<section class="box">
      <h2>Черновик</h2>
      ${cs.length ? `<ul class="dlist">${cs.map((c) => `<li class="${TAG[kindOf(c)][1]}">
          <div><span class="tag ${TAG[kindOf(c)][1]}">${esc(TAG[kindOf(c)][0])}</span> <b>${esc(c.subject)}</b>
          <span>${esc(fmtShort(c.date))}, ${c.start}${changeDetails(c) ? " · " + esc(changeDetails(c)) : ""}</span></div>
          <button type="button" class="btn icon-btn ghost" data-rm="${esc(c.uid)}" aria-label="Убрать">${X}</button></li>`).join("")}</ul>`
        : `<p class="note-muted">Отмечайте изменения в расписании слева — они соберутся здесь. Студенты увидят их только после публикации.</p>`}
      <div class="nbox">
        <label class="chk big"><input type="checkbox" data-n="send"${n.send ? " checked" : ""}> Объявление для студентов</label>
        <div ${n.send ? "" : "hidden"} data-nbody>
          <div class="recips"><span class="muted">Кому:</span>
            ${n.all ? "<b>всем студентам</b>" : groups.length ? esc(groupsBrief(groups)) : `<span class="warn-text">не выбрано</span>`}
            <div class="recip-act">
              ${!n.all && canAddOpen ? `<button type="button" class="link" data-addgroup>+ открытая группа (${esc(idx.groupByKey[openKey].name)})</button>` : ""}
              ${!n.all && n.groups.length ? `<button type="button" class="link" data-cleargroups>убрать добавленные</button>` : ""}
              <label class="chk"><input type="checkbox" data-n="all"${n.all ? " checked" : ""}> всем студентам</label>
            </div>
          </div>
          <label class="field"><span>Заголовок</span><input type="text" data-n="title" maxlength="120" value="${esc(n.title)}" placeholder="Например: Изменения в расписании"></label>
          <label class="field"><span>Текст</span><textarea data-n="body" rows="${Math.min(10, Math.max(4, n.body.split("\n").length + 1))}" maxlength="2000" placeholder="Что случилось и что делать студентам">${esc(n.body)}</textarea></label>
          <details class="zh"><summary>На китайском — для иностранных студентов${n.title_zh ? "" : " (необязательно)"}</summary>
            <label class="field"><span>标题 · заголовок</span><input type="text" data-n="title_zh" maxlength="120" value="${esc(n.title_zh)}"></label>
            <label class="field"><span>内容 · текст</span><textarea data-n="body_zh" rows="3" maxlength="2000">${esc(n.body_zh)}</textarea></label>
            <p class="note-muted">${cs.length ? "Составлено автоматически по изменениям. Если меняете русский текст, поправьте и этот (или очистите — тогда покажется русский)." : "Если оставить пустым, иностранные студенты увидят русский текст."}</p>
          </details>
          ${Object.values(n.touched).some(Boolean) && cs.length ? `<button type="button" class="link" data-autotext>Составить текст заново по изменениям</button>` : ""}
        </div>
      </div>
      ${pubError ? `<div class="warn">${esc(pubError)}</div>` : ""}
      <button type="button" class="btn primary big" data-publish ${busy || (!cs.length && !n.send) ? "disabled" : ""}>${busy ? "Публикую…" : "Опубликовать"}</button>
      <p class="note-muted small">${pub.github ? "На сайте появится через 1–2 минуты. Приложение для Android сообщит студентам этих групп." : "Публикация на сайт не настроена — сохранится только на этом компьютере."}</p>
      ${cs.length || n.title || n.body ? `<button type="button" class="link danger-link" data-clear>Очистить черновик</button>` : ""}
    </section>`;
    $$("[data-rm]", box).forEach((b) => (b.onclick = () => removeDraft(b.dataset.rm)));
    $$("[data-n]", box).forEach((el) => {
      const k = el.dataset.n;
      if (el.type === "checkbox") el.onchange = () => { n[k] = el.checked; saveDraft(); renderDraft(); };
      else el.oninput = () => { n[k] = el.value; n.touched[k] = el.value.trim() !== "" && el.value !== auto[k]; saveDraft(); };
    });
    const ag = $("[data-addgroup]", box);
    if (ag) ag.onclick = () => { n.groups.push(openKey); saveDraft(); renderDraft(); };
    const cg = $("[data-cleargroups]", box);
    if (cg) cg.onclick = () => { n.groups = []; saveDraft(); renderDraft(); };
    const at = $("[data-autotext]", box);
    if (at) at.onclick = () => { n.touched = {}; saveDraft(); renderDraft(); };
    const cl = $("[data-clear]", box);
    if (cl) cl.onclick = () => { if (confirm("Очистить черновик? Изменения из него не будут опубликованы.")) { draft = emptyDraft(); pubError = ""; saveDraft(); renderAll(); } };
    $("[data-publish]", box).onclick = () => publish(hasRecip);
  }

  async function publish(hasRecip) {
    const n = draft.notice;
    pubError = "";
    if (n.send) {
      if (!n.title.trim() || !n.body.trim()) pubError = "Заполните заголовок и текст объявления (или снимите галочку «Объявление для студентов»).";
      else if (!hasRecip) pubError = "Выберите, кому объявление: откройте группу слева и нажмите «+ открытая группа» или отметьте «всем студентам».";
    }
    if (pubError) return renderDraft();
    const body = {
      changes: draft.changes.map(({ uid, ...c }) => c),
      notice: n.send ? { title: n.title, body: n.body, title_zh: n.title_zh, body_zh: n.body_zh, all: n.all, groups: n.all ? [] : noticeGroups() } : null,
    };
    busy = true; renderDraft();
    try {
      const j = await api("publish", body);
      feed = j.feed;
      draft = emptyDraft(); saveDraft();
      toast(j.github ? "Опубликовано. На сайте появится через 1–2 минуты." : "Сохранено на этом компьютере (публикация на сайт не настроена).", 7000);
    } catch (e) {
      pubError = e.message;
    } finally {
      busy = false;
      renderAll();
    }
  }

  async function revert(id) {
    const c = feed.changes.find((x) => x.id === id);
    if (!c) return;
    if (!confirm(`Вернуть как в расписании?\n\n${c.subject}, ${fmtDay(c.date)}, ${c.start}\n\nИзменение исчезнет с сайта через 1–2 минуты. Студентам лучше написать объявление.`)) return;
    try {
      feed = (await api("revert", { id })).feed;
      toast("Готово: занятие как в расписании.");
    } catch (e) { toast(e.message, 8000); }
    renderAll();
  }
  async function deleteNotice(id) {
    const n = feed.notices.find((x) => x.id === id);
    if (!n || !confirm(`Убрать объявление «${n.title}» с сайта?`)) return;
    try {
      feed = (await api("notice/delete", { id })).feed;
      toast("Объявление убрано.");
    } catch (e) { toast(e.message, 8000); }
    renderAll();
  }

  // ------------------------------------------------------------ опубликованное
  function publishedHTML() {
    const cs = [...feed.changes].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    const up = cs.filter(upcoming), past = cs.filter((c) => !upcoming(c)).reverse();
    const item = (c) => `<li class="${TAG[kindOf(c)][1]}"><div>
        <div><span class="tag ${TAG[kindOf(c)][1]}">${esc(TAG[kindOf(c)][0])}</span> <b>${esc(c.subject)}</b></div>
        <span>${esc(fmtShort(c.date))}, ${c.start}–${c.end}${list(c.teachers) ? " · " + esc(list(c.teachers)) : ""}${changeDetails(c) ? " · " + esc(changeDetails(c)) : ""}</span>
        <span class="muted">${esc(groupsBrief(c.groups))}</span></div>
        <button type="button" class="btn" data-revert="${esc(c.id)}">Вернуть как было</button></li>`;
    const notices = [...feed.notices].sort((a, b) => b.time.localeCompare(a.time));
    return `<section class="box">
      <h2>Изменения в расписании</h2>
      ${up.length ? `<ul class="plist2">${up.map(item).join("")}</ul>` : `<p class="note-muted">Предстоящих изменений нет.</p>`}
      ${past.length ? `<details class="past-box"><summary>Прошедшие (${past.length})</summary><ul class="plist2">${past.map(item).join("")}</ul></details>` : ""}
    </section>
    <section class="box">
      <h2>Объявления</h2>
      ${notices.length ? `<ul class="plist2">${notices.map((n) => `<li><div>
          <div><b>${esc(n.title)}</b> <span class="muted">· ${esc(fmtTime(n.time))}</span></div>
          <span class="pre">${esc(n.body)}</span>
          <span class="muted">${n.all ? "Всем студентам" : esc(groupsBrief(n.groups))}</span></div>
          <button type="button" class="btn" data-delnotice="${esc(n.id)}">Убрать с сайта</button></li>`).join("")}</ul>`
        : `<p class="note-muted">Объявлений нет.</p>`}
      <p class="note-muted small">Прошедшие изменения и объявления старше ${60} дней убираются с сайта автоматически.</p>
    </section>`;
  }

  // ------------------------------------------------------------ сборка
  function render() {
    renderStatus();
    const main = $("#main");
    rowRefs.clear();
    if (S.tab === "published") {
      main.innerHTML = publishedHTML();
      $$("[data-revert]", main).forEach((b) => (b.onclick = () => revert(b.dataset.revert)));
      $$("[data-delnotice]", main).forEach((b) => (b.onclick = () => deleteNotice(b.dataset.delnotice)));
      return;
    }
    main.innerHTML = controlsHTML() + weekHTML();
    bindControls(main);
    bindWeek(main);
  }
  function renderAll() { render(); renderDraft(); }

  async function init() {
    $$(".tabs button").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; saveView(); render(); }));
    try {
      const r = await fetch("/data/schedule.json", { cache: "no-cache" });
      setData(await r.json());
    } catch {
      $("#main").innerHTML = `<div class="empty-box">Не удалось загрузить расписание. Перезапустите программу.</div>`;
      return;
    }
    if (!idx.source[S.sourceId]) S.sourceId = D.sources[0]?.id;
    if (S.groupId && !idx.group[S.groupId]) S.groupId = null;
    try {
      const j = await api("state");
      feed = j.feed; pub = j.publishing;
    } catch (e) {
      pub = { github: false, error: e.message };
      toast(e.message, 10000);
    }
    renderAll();
    // лента могла измениться с другого компьютера — обновляем, когда возвращаются к вкладке
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible" || busy || $("#dlg").open) return;
      try { const j = await api("state"); feed = j.feed; pub = j.publishing; renderAll(); } catch { /* покажем при публикации */ }
    });
  }
  init();
})();

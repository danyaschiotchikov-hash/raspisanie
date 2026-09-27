"""Сбор и разбор расписания Петрозаводской государственной консерватории им. А.К. Глазунова.

Обходит раздел «Обучение» на glazunovcons.ru, находит PDF-файлы с расписанием
занятий текущего семестра, скачивает их и разбирает табличную сетку
(день × пара × специальность) в единый JSON.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import io
import hashlib
import json
import re
import sys
import urllib.request
from html import unescape
from pathlib import Path
from urllib.parse import urljoin, urlparse, unquote

import pymupdf

BASE = "https://glazunovcons.ru"
STUDY_PAGES = [
    "/study/undergraduate_study/",
    "/study/graduate_study/",
    "/study/masterprogramme/",
    "/study/postgraduate_education/",
    "/study/foreign_students/",
]
UA = "Mozilla/5.0 (schedule-viewer; +https://glazunovcons.ru)"

DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]

# Файлы сессий, выпускных экзаменов и заочной формы — не регулярное расписание занятий.
EXCLUDE = ("sessi", "z_s_", "zimn", "letn", "leto", "vyp", "exam", "zfo", "gia")
SEM_RE = re.compile(r"(?<!\d)([12])_sem(?:estr)?_(\d{4})-(\d{4})", re.I)

TIME_RANGE_RE = re.compile(r"(\d{1,2})[.:](\d{2})\s*[-–—]\s*(\d{1,2})[.:](\d{2})")
TEACHER_RE = re.compile(
    r"([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)\s*,?\s+([А-ЯЁ])\.\s?([А-ЯЁ])\.?"
)
ROOM_RE = re.compile(
    r"(?:Каб(?:инет)?\.?\s*№?\s*\d+(?:\s*/\s*\d+)?\s*[а-яa-z]?(?![а-яё])"
    r"|Ауд(?:итория)?\.?\s*№?\s*\d+\s*[а-я]?(?![а-яё])"
    r"|(?:Большой|Малый|Органный|Камерный|Концертный)\s+(?:концертный\s+)?зал\.?"
    r"|Спорт(?:ивный|\.)?\s*зал"
    r"|Опер\w*\s+студия)",
    re.I,
)


# ---------------------------------------------------------------- сеть

def fetch(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def find_pdf_links(log=print) -> list[dict]:
    """Все ссылки на PDF со страниц раздела «Обучение» (вместе со страницей, где найдены)."""
    pages = list(STUDY_PAGES)
    try:
        html = fetch(BASE + "/study/").decode("utf-8", "replace")
        for href in re.findall(r'href="(/study/[^"#?]+/)"', html):
            if href not in pages and href.count("/") == 3:
                pages.append(href)
    except Exception as e:  # noqa: BLE001
        log(f"  ! не удалось прочитать /study/: {e}")

    links: dict[str, dict] = {}
    for page in pages:
        url = BASE + page
        try:
            html = fetch(url).decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            log(f"  ! {url}: {e}")
            continue
        for href in re.findall(r'href="([^"]+\.pdf)"', html, re.I):
            full = urljoin(url, unescape(href)).replace("http://", "https://")
            links.setdefault(full, {"url": full, "page": url})
    return list(links.values())


def select_current(links: list[dict]) -> tuple[list[dict], tuple[int, int] | None]:
    """Оставляет только регулярное расписание самого свежего семестра."""
    cands = []
    for l in links:
        path = unquote(urlparse(l["url"]).path).lower()
        if any(x in path for x in EXCLUDE):
            continue
        m = SEM_RE.search(path.rsplit("/", 1)[-1])
        if not m:
            continue
        sem, y1 = int(m.group(1)), int(m.group(2))
        cands.append(({**l, "sem": sem, "year": y1}, (y1, sem)))
    if not cands:
        return [], None
    latest = max(k for _, k in cands)
    return [l for l, k in cands if k == latest], latest


# ---------------------------------------------------------------- метаданные файла

ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5}


def describe(url: str) -> dict:
    name = unquote(urlparse(url).path).rsplit("/", 1)[-1].lower()
    course = None
    m = re.search(r"(?:^|_)(\d)_kurs", name) or re.search(r"mag_?(\d)", name)
    if m:
        course = int(m.group(1))
    foreign = "knr" in name
    if "spo" in name:
        level, order = "Колледж (СПО)", 0
    elif "mag" in name:
        level, order = "Магистратура", 2
    elif "aspir" in name or re.search(r"(?:^|_)asp(?:_|$)", name):
        level, order = "Аспирантура", 3
    elif "assist" in name:
        level, order = "Ассистентура-стажировка", 4
    else:
        level, order = "Бакалавриат и специалитет", 1
    if foreign:
        order += 10
    return {"level": level, "foreign": foreign, "course": course, "order": order}


# ---------------------------------------------------------------- разбор PDF

def _cluster(values: list[float], tol: float = 1.2) -> list[float]:
    out: list[float] = []
    for v in sorted(values):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


def _index(bounds: list[float], v: float, tol: float = 1.2) -> int:
    best = min(range(len(bounds)), key=lambda i: abs(bounds[i] - v))
    return best if abs(bounds[best] - v) <= tol * 2 else -1


def clean_text(lines: list[str]) -> str:
    s = ""
    for ln in lines:
        ln = ln.strip()
        if not ln:
            continue
        if s.endswith("-") and ln[:1].islower() and not s.endswith(" -"):
            # «учебно-» + «воспит.» — составное слово, дефис сохраняем;
            # «индивиду-» + «альному» — перенос, склеиваем
            frag = re.search(r"(\w+)-$", s)
            compound = frag and len(frag.group(1)) >= 4 and frag.group(1)[-1] in "ое"
            s = s + ln if compound else s[:-1] + ln
        else:
            s = (s + " " + ln) if s else ln
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s+([,.;:)])", r"\1", s)
    s = re.sub(r"\(\s+", "(", s)
    return s.strip()


def page_grid(page: pymupdf.Page):
    """Возвращает (cells, xs, ys): cells — список {c0,c1,r0,r1,text}."""
    with contextlib.redirect_stdout(io.StringIO()):  # подсказка pymupdf про pymupdf_layout
        tabs = page.find_tables().tables
    if not tabs:
        return None
    t = max(tabs, key=lambda t: t.row_count * t.col_count)
    boxes = [c for c in t.cells if c]
    xs = _cluster([c[0] for c in boxes] + [c[2] for c in boxes])
    ys = _cluster([c[1] for c in boxes] + [c[3] for c in boxes])

    lines = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            text = "".join(sp["text"] for sp in l["spans"])
            if not text.strip():
                continue
            x0, y0, x1, y1 = l["bbox"]
            lines.append(((x0 + x1) / 2, (y0 + y1) / 2, y0, x0, text))

    cells = []
    for (x0, y0, x1, y1) in boxes:
        c0, c1 = _index(xs, x0), _index(xs, x1)
        r0, r1 = _index(ys, y0), _index(ys, y1)
        if min(c0, c1, r0, r1) < 0 or c1 <= c0 or r1 <= r0:
            continue
        inside = [ln for ln in lines if x0 <= ln[0] <= x1 and y0 <= ln[1] <= y1]
        inside.sort(key=lambda ln: (round(ln[2], 0), ln[3]))
        cells.append({"c0": c0, "c1": c1, "r0": r0, "r1": r1,
                      "x": (x0 + x1) / 2, "text": clean_text([ln[4] for ln in inside])})
    return cells, xs, ys


def norm_time(h: str, m: str) -> str:
    return f"{int(h):02d}:{m}"


def parse_slot(text: str):
    m = TIME_RANGE_RE.search(text or "")
    if not m:
        return None
    return norm_time(m.group(1), m.group(2)), norm_time(m.group(3), m.group(4))


def match_day(text: str):
    t = (text or "").replace(" ", "").lower()
    for i, d in enumerate(DAYS):
        if t.startswith(d.lower()[:4]):
            return i
    return None


def parse_pdf(path: Path) -> dict:
    """Разбирает один PDF: список специальностей (столбцов) и занятий."""
    doc = pymupdf.open(path)
    groups: list[dict] = []          # {col, x, name, individual}
    raw_lessons: list[dict] = []     # {cols:[...], day, row_slots:[(s,e)], text}
    title_bits = []
    current_day = prev_start = None  # переносятся на следующую страницу

    for pno, page in enumerate(doc):
        grid = page_grid(page)
        if not grid:
            continue
        cells, xs, ys = grid
        ncols, nrows = len(xs) - 1, len(ys) - 1

        # карта: (row, col) -> cell
        at: dict[tuple[int, int], dict] = {}
        for c in cells:
            for r in range(c["r0"], c["r1"]):
                for k in range(c["c0"], c["c1"]):
                    at[(r, k)] = c

        def txt(r, k):
            c = at.get((r, k))
            return c["text"] if c else ""

        # Строка «По индивидуальному графику» и заголовок над ней
        ind_row = next((r for r in range(nrows) if txt(r, 1).lower().startswith("по индивид")), None)
        if ind_row is not None and not groups:
            head_row = ind_row - 1
            for k in range(2, ncols):
                name = txt(head_row, k)
                cell = at.get((head_row, k))
                if not name or not cell or cell["c0"] != k or parse_slot(name) or match_day(name) is not None:
                    continue
                groups.append({"col": k, "x": cell["x"], "name": name,
                               "individual": txt(ind_row, k)})
            if pno == 0:
                title_bits.append(page.get_text("text", clip=pymupdf.Rect(0, 0, page.rect.width, ys[0] + 1)))
        if not groups:
            continue

        # Сопоставление столбцов текущей страницы со специальностями (по координате x)
        col_of_group = {}
        for gi, g in enumerate(groups):
            if ind_row is not None or pno == 0:
                col_of_group[gi] = g["col"]
            else:
                best = None
                for k in range(ncols):
                    cx = (xs[k] + xs[k + 1]) / 2
                    if abs(cx - g["x"]) < (xs[k + 1] - xs[k]) / 2:
                        best = k
                col_of_group[gi] = best if best is not None else g["col"]

        start_row = (ind_row + 1) if ind_row is not None else 0
        if ind_row is not None:
            current_day, prev_start = None, None
        seen = set()
        for r in range(start_row, nrows):
            slot = parse_slot(txt(r, 1))
            if not slot:
                continue
            # День берём из подписи в первом столбце; если подпись не видна (обрезана
            # на границе страниц), новый день определяем по «сбросу» времени к утру
            d = match_day(txt(r, 0))
            if d is not None:
                current_day = d
            elif current_day is not None and prev_start and slot[0] < prev_start:
                current_day = min(current_day + 1, 6)
            prev_start = slot[0]
            if current_day is None:
                continue
            for gi, k in col_of_group.items():
                cell = at.get((r, k))
                if not cell or not cell["text"] or id(cell) in seen:
                    continue
                seen.add(id(cell))
                # занятие может занимать несколько строк (объединённая ячейка)
                slots = [parse_slot(txt(rr, 1)) for rr in range(cell["r0"], cell["r1"])]
                slots = [s for s in slots if s]
                cols = [gj for gj, kk in col_of_group.items() if cell["c0"] <= kk < cell["c1"]]
                raw_lessons.append({"groups": cols, "day": current_day,
                                    "start": slots[0][0], "end": slots[-1][1],
                                    "text": cell["text"]})

    title = clean_text(" ".join(title_bits).splitlines())
    created = doc.metadata.get("creationDate") or ""
    m = re.match(r"D:(\d{4})(\d{2})(\d{2})", created)
    updated = f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None
    return {"groups": groups, "lessons": raw_lessons, "title": title, "updated": updated}


# ---------------------------------------------------------------- разбор ячейки

def parse_cell(text: str) -> dict:
    times = [(norm_time(a, b), norm_time(c, d)) for a, b, c, d in TIME_RANGE_RE.findall(text)]
    rest = TIME_RANGE_RE.sub(" ", text)

    teachers = []
    first_pos = len(rest)
    for m in TEACHER_RE.finditer(rest):
        name = f"{m.group(1)} {m.group(2)}.{m.group(3)}."
        if m.group(1).lower() in {"каб", "ауд", "зал", "группа"}:
            continue
        if name not in teachers:
            teachers.append(name)
        first_pos = min(first_pos, m.start())
    rooms = []
    for m in ROOM_RE.finditer(rest):
        room = re.sub(r"\s+", " ", m.group(0)).strip().rstrip(".")
        room = re.sub(r"^Каб(?:инет)?\.?\s*№?\s*", "Каб. ", room, flags=re.I)
        if room.lower().startswith("спорт"):
            room = "Спортзал"
        elif room.lower().startswith("опер"):
            room = "Оперная студия"
        if room not in rooms:
            rooms.append(room)
        first_pos = min(first_pos, m.start())

    subject = rest[:first_pos]
    subject = re.sub(r"\s+", " ", subject).strip(" ,.;:-–")
    if not subject:
        subject = re.sub(r"\s+", " ", TEACHER_RE.sub("", ROOM_RE.sub("", rest))).strip(" ,.;:-–") or text
    return {"subject": subject, "teachers": teachers, "rooms": rooms, "times": times}


def split_cell(text: str) -> list[str]:
    """«Предмет А, Иванов И.И. / Предмет Б, Петров П.П.» — два занятия в одной ячейке.
    Если вторая часть начинается сразу с преподавателя, предмет берётся из первой."""
    parts = [p.strip() for p in re.split(r"\s*/\s*(?=[А-ЯЁ])", text) if p.strip()]
    if len(parts) < 2:
        return [text]
    first_subject = parse_cell(parts[0])["subject"]
    return [p if i == 0 or not TEACHER_RE.match(p) else f"{first_subject}, {p}"
            for i, p in enumerate(parts)]


# ---------------------------------------------------------------- сборка

def build(data_dir: Path, cache_dir: Path | None = None, log=print) -> dict:
    data_dir.mkdir(parents=True, exist_ok=True)
    pdf_dir = cache_dir or (Path(__file__).parent / ".cache" / "pdf")
    pdf_dir.mkdir(parents=True, exist_ok=True)

    log("Ищу файлы расписания на glazunovcons.ru …")
    links = find_pdf_links(log)
    current, key = select_current(links)
    if not current:
        raise RuntimeError("На сайте не найдено файлов с расписанием занятий")
    year, sem = key
    log(f"Найдено {len(current)} файлов: {sem} семестр {year}–{year + 1}")

    sources, groups, lessons = [], [], []
    for l in current:
        url = l["url"]
        fname = unquote(urlparse(url).path).rsplit("/", 1)[-1]
        local = pdf_dir / (hashlib.md5(url.encode()).hexdigest()[:8] + "_" + fname)
        log(f"  ↓ {fname}")
        local.write_bytes(fetch(url))
        parsed = parse_pdf(local)
        meta = describe(url)

        sid = f"s{len(sources)}"
        course_label = f"{meta['course']} курс" if meta["course"] else ""
        program = meta["level"] + (" · иностранные студенты" if meta["foreign"] else "")
        sources.append({
            "id": sid, "url": url, "page": l["page"], "file": fname,
            "program": program, "level": meta["level"], "foreign": meta["foreign"],
            "course": meta["course"], "courseLabel": course_label,
            "order": meta["order"], "updated": parsed["updated"],
        })
        gids = []
        for g in parsed["groups"]:
            gid = f"{sid}g{len(gids)}"
            gids.append(gid)
            groups.append({"id": gid, "key": f"{fname}#{g['name']}", "source": sid, "name": g["name"],
                           "individual": g["individual"]})
        for rl in parsed["lessons"]:
            lessons.append({**rl, "groups": [gids[i] for i in rl["groups"]]})
        log(f"    специальностей: {len(gids)}, занятий: {len(parsed['lessons'])}")

    # 1) Раскладываем по группам и склеиваем одно занятие, растянутое на соседние
    #    пары (в ячейках повторяется текст со «своим» временем, напр. 09.00-11.20)
    per_group: dict[str, list[dict]] = {}
    for rl in lessons:
        for part in split_cell(rl["text"]):
            for g in rl["groups"]:
                per_group.setdefault(g, []).append({**rl, "text": part, "groups": [g]})
    spans: list[dict] = []
    for g, items in per_group.items():
        items.sort(key=lambda x: (x["day"], x["start"]))
        for it in items:
            prev = spans[-1] if spans and spans[-1]["groups"] == [g] else None
            if (prev and prev["day"] == it["day"] and prev["text"] == it["text"]
                    and TIME_RANGE_RE.search(it["text"]) and prev["end"] >= _minus(it["start"], 30)):
                prev["end"] = it["end"]
            else:
                spans.append(dict(it))

    parsed_spans = []
    for it in spans:
        p = parse_cell(it["text"])
        start, end = it["start"], it["end"]
        if p["times"]:
            start = min(t[0] for t in p["times"])
            end = max(t[1] for t in p["times"])
        parsed_spans.append({**it, **p, "start": start, "end": end,
                             "slot0": it["start"], "slot1": it["end"]})

    # у одной группы то же занятие, целиком входящее в более длинное, — дубль
    def same(a, b):
        return (a["groups"] == b["groups"] and a["day"] == b["day"]
                and a["subject"].lower() == b["subject"].lower() and a["teachers"] == b["teachers"])
    parsed_spans = [a for a in parsed_spans if not any(
        b is not a and same(a, b) and b["start"] <= a["start"] and a["end"] <= b["end"]
        and (b["start"], b["end"]) != (a["start"], a["end"]) for b in parsed_spans)]

    # 2) Одинаковые занятия в одно и то же время — это поток: одна запись, много групп
    merged: dict[tuple, dict] = {}
    for it in parsed_spans:
        k = (it["day"], it["start"], it["end"], re.sub(r"\W", "", it["subject"].lower()),
             tuple(it["teachers"]), tuple(it["rooms"]))
        if k in merged:
            m = merged[k]
            m["groups"] += [g for g in it["groups"] if g not in m["groups"]]
            m["slot0"] = min(m["slot0"], it["slot0"])
            m["slot1"] = max(m["slot1"], it["slot1"])
        else:
            merged[k] = dict(it)

    gorder = {g["id"]: i for i, g in enumerate(groups)}
    final = []
    for i, it in enumerate(sorted(merged.values(), key=lambda x: (x["day"], x["start"], x["end"]))):
        final.append({
            "id": i, "day": it["day"], "start": it["start"], "end": it["end"],
            "slot": f"{it['slot0']}–{it['slot1']}",
            "exact": [f"{a}–{b}" for a, b in it["times"]],
            "subject": it["subject"], "teachers": it["teachers"], "rooms": it["rooms"],
            "text": it["text"], "groups": sorted(it["groups"], key=lambda g: gorder[g]),
        })

    teachers: dict[str, int] = {}
    for it in final:
        for t in it["teachers"]:
            teachers[t] = teachers.get(t, 0) + 1

    data = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "semester": {"year": year, "sem": sem,
                     "label": f"{sem} семестр {year}/{year + 1} учебного года"},
        "sources": sorted(sources, key=lambda s: (s["order"], s["course"] or 0)),
        "groups": groups,
        "lessons": final,
        "teachers": sorted(teachers, key=lambda s: s.lower()),
    }
    (data_dir / "schedule.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), "utf-8")
    log(f"Готово: {len(groups)} групп, {len(final)} занятий, {len(teachers)} преподавателей")
    return data


def _minus(hhmm: str, minutes: int) -> str:
    h, m = map(int, hhmm.split(":"))
    t = max(0, h * 60 + m - minutes)
    return f"{t // 60:02d}:{t % 60:02d}"


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    import argparse
    ap = argparse.ArgumentParser(description="Скачать и разобрать расписание с glazunovcons.ru")
    ap.add_argument("--out", default=str(Path(__file__).parent / "site" / "data"), help="куда сохранить schedule.json")
    ap.add_argument("--cache", default=None, help="папка для скачанных PDF")
    a = ap.parse_args()
    build(Path(a.out), Path(a.cache) if a.cache else None)

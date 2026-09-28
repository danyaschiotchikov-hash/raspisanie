"""Изменения в расписании от учебного отдела — без своего сервера.

Лента изменений — обычный файл site/data/feed.json: GitHub Pages публикует его рядом с расписанием,
сайт и Android-приложение просто скачивают его.

Учебный отдел правит ленту в панели на своём компьютере (python app.py → http://localhost:8765/admin/),
а программа сохраняет файл прямо в репозиторий на GitHub. GitHub Actions публикует сайт за 1–2 минуты.
Если публикация не настроена, изменения сохраняются только в site/data/feed.json на этом компьютере.

Настройки публикации — local-data/github.json (в git не попадает; путь можно задать переменной RASP_DATA):
  {"repo": "владелец/репозиторий", "branch": "main", "token": "github_pat_…"}
Создаются командой: python app.py github

Изменение (change) относится к одному занятию в одну дату:
  cancel — отменено; change — перенесено или заменены преподаватель / аудитория; add — дополнительное занятие.
Объявление (notice) — текст для выбранных групп (или всех), может ссылаться на изменения.
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("RASP_DATA") or ROOT / "local-data")
FEED_REPO_PATH = "site/data/feed.json"
FEED_FILE = ROOT / FEED_REPO_PATH
MSK = dt.timezone(dt.timedelta(hours=3))  # Петрозаводск, без перехода на летнее время

FEED_DAYS = 60  # прошедшие изменения и объявления старше этого убираем из ленты (в истории git они остаются)
# по этому началу сообщения GitHub Actions понимает, что расписание с сайта консерватории заново скачивать не нужно
COMMIT_PREFIX = "Изменения в расписании: "
TOKEN_URL = "https://github.com/settings/personal-access-tokens/new"

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class Conflict(Exception):
    """Файл на GitHub изменился, пока мы его правили."""


def now_msk() -> dt.datetime:
    return dt.datetime.now(MSK).replace(microsecond=0)


def empty_feed() -> dict:
    return {"rev": 0, "changes": [], "notices": []}


def read_feed(path: Path) -> dict:
    try:
        feed = json.loads(path.read_text("utf-8"))
        return feed if not validate_feed(feed) else empty_feed()
    except (OSError, ValueError):
        return empty_feed()


# ---------------------------------------------------------------- проверка входных данных

def _str(v, limit: int, required: bool = False, field: str = "") -> str:
    s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(v or "")).strip()
    if required and not s:
        raise ApiError(400, f"Не заполнено поле «{field}»")
    return s[:limit]


def _list(v, limit: int, item_limit: int) -> list[str]:
    if not isinstance(v, list):
        return []
    out = []
    for x in v[:limit]:
        s = _str(x, item_limit)
        if s and s not in out:
            out.append(s)
    return out


def _date(v, field: str = "дата") -> str:
    s = str(v or "")
    if not DATE_RE.match(s):
        raise ApiError(400, f"Неверная дата: {field}")
    try:
        dt.date.fromisoformat(s)
    except ValueError:
        raise ApiError(400, f"Неверная дата: {field}") from None
    return s


def _time(v, field: str = "время") -> str:
    s = str(v or "")
    if len(s) == 4 and s[1] == ":":
        s = "0" + s
    if not TIME_RE.match(s):
        raise ApiError(400, f"Неверное время: {field}")
    return s


def _slot(obj: dict) -> tuple[str, str]:
    start, end = _time(obj.get("start"), "начало"), _time(obj.get("end"), "конец")
    if end <= start:
        raise ApiError(400, "Время окончания должно быть позже начала")
    return start, end


def clean_change(c: dict, stamp: str) -> dict:
    kind = c.get("type")
    if kind not in ("cancel", "change", "add"):
        raise ApiError(400, "Неизвестный вид изменения")
    start, end = _slot(c)
    out = {
        "id": _str(c.get("id"), 20) or "c" + secrets.token_hex(5),
        "type": kind,
        "lesson": _str(c.get("lesson"), 40) if kind != "add" else "",
        "date": _date(c.get("date")),
        "start": start, "end": end,
        "subject": _str(c.get("subject"), 200, True, "дисциплина"),
        "teachers": _list(c.get("teachers"), 10, 80),
        "rooms": _list(c.get("rooms"), 10, 80),
        "groups": _list(c.get("groups"), 400, 300),
        "note": _str(c.get("note"), 300),
        "created": _str(c.get("created"), 40) or stamp,
    }
    if kind != "add" and not out["lesson"]:
        raise ApiError(400, "Не указано занятие")
    if not out["groups"]:
        raise ApiError(400, "Не указаны группы")
    if kind == "change":
        to = c.get("to") or {}
        s2, e2 = _slot(to)
        out["to"] = {"date": _date(to.get("date"), "новая дата"), "start": s2, "end": e2,
                     "teachers": _list(to.get("teachers"), 10, 80), "rooms": _list(to.get("rooms"), 10, 80)}
        if out["to"] == {"date": out["date"], "start": start, "end": end,
                         "teachers": out["teachers"], "rooms": out["rooms"]}:
            raise ApiError(400, "Изменение ничего не меняет")
    if c.get("notice"):
        out["notice"] = _str(c.get("notice"), 20)
    return out


def clean_notice(n: dict, stamp: str) -> dict:
    groups = _list(n.get("groups"), 400, 300)
    everyone = bool(n.get("all"))
    if not everyone and not groups:
        raise ApiError(400, "Выберите, кому адресовано объявление")
    return {
        "id": _str(n.get("id"), 20) or "n" + secrets.token_hex(5),
        "time": _str(n.get("time"), 40) or stamp,
        "title": _str(n.get("title"), 120, True, "заголовок"),
        "body": _str(n.get("body"), 2000, True, "текст"),
        "title_zh": _str(n.get("title_zh"), 120),
        "body_zh": _str(n.get("body_zh"), 2000),
        "groups": [] if everyone else groups,
        "all": everyone,
        "changes": _list(n.get("changes"), 300, 20),
    }


def validate_feed(feed) -> list[str]:
    """Ошибки в файле ленты (для проверки в GitHub Actions перед публикацией)."""
    if not isinstance(feed, dict) or not isinstance(feed.get("changes"), list) or not isinstance(feed.get("notices"), list):
        return ["в файле должны быть списки changes и notices"]
    errors = []
    if not isinstance(feed.get("rev"), int):
        errors.append("rev должен быть числом")
    for kind, items, clean in (("изменение", feed["changes"], clean_change), ("объявление", feed["notices"], clean_notice)):
        ids = set()
        for i, x in enumerate(items):
            name = f"{kind} №{i + 1} ({x.get('id') if isinstance(x, dict) else '?'})"
            if not isinstance(x, dict) or not x.get("id"):
                errors.append(f"{name}: нет id")
                continue
            if x["id"] in ids:
                errors.append(f"{name}: id повторяется")
            ids.add(x["id"])
            try:
                clean(x, "")
            except ApiError as e:
                errors.append(f"{name}: {e}")
    return errors


def prune(feed: dict) -> None:
    """Прошедшее больше FEED_DAYS дней назад из ленты убираем, чтобы файл не рос бесконечно."""
    now = now_msk()
    since_date = (now.date() - dt.timedelta(days=FEED_DAYS)).isoformat()
    since_time = (now - dt.timedelta(days=FEED_DAYS)).isoformat()
    feed["changes"] = [c for c in feed["changes"] if max(c["date"], (c.get("to") or {}).get("date", "")) >= since_date]
    feed["notices"] = [n for n in feed["notices"] if n["time"] >= since_time]


def dump(feed: dict) -> bytes:
    return (json.dumps(feed, ensure_ascii=False, indent=1) + "\n").encode("utf-8")


KIND_LABEL = {"cancel": "отмена", "change": "перенос или замена", "add": "доп. занятие"}


def _dm(iso: str) -> str:
    return f"{iso[8:10]}.{iso[5:7]}"


def describe(changes: list[dict], notice: dict | None) -> str:
    parts = [f"{KIND_LABEL[c['type']]} — {c['subject']}, {_dm(c['date'])}" for c in changes[:3]]
    if len(changes) > 3:
        parts.append(f"и ещё {len(changes) - 3}")
    if notice:
        parts.append(f"объявление «{notice['title']}»")
    return "; ".join(parts)


# ---------------------------------------------------------------- GitHub

class GitHub:
    """Чтение и запись одного файла в репозитории через GitHub API (git на компьютере не нужен)."""

    def __init__(self, cfg: dict):
        self.repo = str(cfg.get("repo") or "").strip().strip("/")
        self.branch = str(cfg.get("branch") or "main").strip()
        self.token = str(cfg.get("token") or "").strip()
        self.api = str(cfg.get("api") or "https://api.github.com").rstrip("/")
        if not re.match(r"^[\w.-]+/[\w.-]+$", self.repo) or not self.token:
            raise ValueError("в настройках публикации нет репозитория или ключа доступа")

    @property
    def site_url(self) -> str:
        owner, name = self.repo.split("/")
        if name.lower() == f"{owner.lower()}.github.io":
            return f"https://{owner.lower()}.github.io/"
        return f"https://{owner.lower()}.github.io/{name}/"

    def _call(self, method: str, path: str, body: dict | None = None) -> tuple[int, object]:
        req = urllib.request.Request(
            self.api + path, method=method,
            data=json.dumps(body).encode("utf-8") if body is not None else None,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "raspisanie-konservatorii",
                **({"Content-Type": "application/json"} if body is not None else {}),
            })
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"null")
            except ValueError:
                return e.code, None
        except (urllib.error.URLError, OSError, ValueError) as e:
            reason = getattr(e, "reason", None) or e
            raise ApiError(502, f"Нет связи с GitHub: {reason}. Проверьте интернет и попробуйте ещё раз.") from None

    def _fail(self, code: int, j) -> None:
        msg = j.get("message", "") if isinstance(j, dict) else ""
        if code == 401:
            raise ApiError(502, "GitHub не принял ключ доступа: он неверный или закончился его срок. "
                                "Создайте новый ключ и выполните: python app.py github")
        if code in (403, 404):
            raise ApiError(502, f"Ключ не даёт менять файлы в репозитории {self.repo} (ветка {self.branch}). "
                                "Проверьте, что ключ выдан для этого репозитория и у него есть право Contents — Read and write, "
                                "затем выполните: python app.py github")
        raise ApiError(502, f"GitHub ответил ошибкой {code}: {msg or 'без описания'}")

    def _check_repo(self) -> None:
        """Файл не найден: это либо нет доступа к репозиторию / ветке, либо файл просто ещё не создан."""
        code, j = self._call("GET", f"/repos/{self.repo}")
        if code == 401:
            self._fail(code, j)
        if code != 200:
            raise ApiError(502, f"Репозиторий {self.repo} не найден. Проверьте название и то, что ключ выдан именно для него.")
        code, j = self._call("GET", f"/repos/{self.repo}/branches/{quote(self.branch)}")
        if code != 200:
            raise ApiError(502, f"В репозитории {self.repo} нет ветки {self.branch}. Укажите ветку сайта (обычно main): python app.py github")

    def get(self) -> tuple[dict, str]:
        """Лента с GitHub и её версия (sha); если файла ещё нет — пустая лента и sha "" (put его создаст)."""
        code, j = self._call("GET", f"/repos/{self.repo}/contents/{FEED_REPO_PATH}?ref={quote(self.branch)}")
        if code == 404:
            self._check_repo()
            return empty_feed(), ""
        if code != 200 or not isinstance(j, dict):
            self._fail(code, j)
        if j.get("encoding") != "base64":
            raise ApiError(502, f"Файл {FEED_REPO_PATH} на GitHub слишком большой")
        try:
            feed = json.loads(base64.b64decode(j["content"]).decode("utf-8"))
        except ValueError:
            raise ApiError(502, f"Файл {FEED_REPO_PATH} на GitHub повреждён — исправьте его вручную") from None
        if validate_feed(feed)[:1] == ["в файле должны быть списки changes и notices"]:
            raise ApiError(502, f"Файл {FEED_REPO_PATH} на GitHub повреждён — исправьте его вручную")
        return feed, j["sha"]

    def put(self, feed: dict, sha: str, message: str) -> str:
        """Сохраняет ленту; sha "" — создать файл (если его успели создать с другого компьютера — Conflict)."""
        code, j = self._call("PUT", f"/repos/{self.repo}/contents/{FEED_REPO_PATH}", {
            "message": message,
            "content": base64.b64encode(dump(feed)).decode("ascii"),
            "branch": self.branch,
            **({"sha": sha} if sha else {}),
        })
        msg = j.get("message", "") if isinstance(j, dict) else ""
        if code == 409 or (code == 422 and "sha" in msg.lower()):
            raise Conflict()
        if code not in (200, 201) or not isinstance(j, dict):
            self._fail(code, j)
        return (j.get("commit") or {}).get("html_url", "")


# ---------------------------------------------------------------- лента

class Store:
    def __init__(self, data_dir: Path = DATA, feed_file: Path = FEED_FILE, log=print):
        self.data_dir = data_dir
        self.feed_file = feed_file
        self.log = log
        self.lock = threading.Lock()
        self.gh: GitHub | None = None
        self.error = ""
        cfg_file = data_dir / "github.json"
        if cfg_file.exists():
            try:
                self.gh = GitHub(json.loads(cfg_file.read_text("utf-8")))
            except (OSError, ValueError) as e:
                self.error = f"Не удалось прочитать {cfg_file}: {e}"
        self.feed = self._read_local()

    def _read_local(self) -> dict:
        return read_feed(self.feed_file)

    def _save_local(self, feed: dict) -> None:
        self.feed = feed
        self.feed_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.feed_file.with_name(self.feed_file.name + ".tmp")
        tmp.write_bytes(dump(feed))
        os.replace(tmp, self.feed_file)

    def publishing(self) -> dict:
        if not self.gh:
            return {"github": False, "error": self.error}
        return {"github": True, "repo": self.gh.repo, "branch": self.gh.branch, "site": self.gh.site_url, "error": self.error}

    def sync(self) -> dict:
        """Свежая лента с GitHub (её могли поправить с другого компьютера); при ошибке — сохранённая копия."""
        if not self.gh:
            self.feed = self._read_local()
            return self.feed
        with self.lock:
            try:
                feed, _ = self.gh.get()
            except ApiError as e:
                self.error = str(e)
                return self.feed
            self.error = ""
            self._save_local(feed)
            return feed

    def _modify(self, op) -> dict:
        """Скачивает ленту, применяет op и сохраняет; если файл на GitHub успели изменить — повторяет.

        op(feed) правит ленту на месте и возвращает (ответ панели, описание для истории на GitHub)."""
        with self.lock:
            for _ in range(3):
                if self.gh:
                    feed, sha = self.gh.get()
                else:
                    feed, sha = self._read_local(), ""
                result, message = op(feed)
                prune(feed)
                feed["rev"] = int(feed.get("rev", 0)) + 1
                commit = ""
                if self.gh:
                    try:
                        commit = self.gh.put(feed, sha, COMMIT_PREFIX + message)
                    except Conflict:
                        continue
                    self.error = ""
                self._save_local(feed)
                self.log(f"  {message}" + (" → GitHub" if self.gh else " (только на этом компьютере)"))
                return {**result, "feed": feed, "commit": commit, "github": bool(self.gh)}
        raise ApiError(409, "Изменения одновременно сохраняли с другого компьютера. Нажмите «Опубликовать» ещё раз.")

    def publish(self, payload: dict) -> dict:
        raw = payload.get("changes") or []
        if not isinstance(raw, list) or len(raw) > 300:
            raise ApiError(400, "Слишком много изменений за раз")
        stamp = now_msk().isoformat()
        changes = [clean_change({k: v for k, v in c.items() if k not in ("id", "created", "notice")}, stamp)
                   for c in raw if isinstance(c, dict)]
        notice = None
        if isinstance(payload.get("notice"), dict):
            notice = clean_notice({k: v for k, v in payload["notice"].items() if k not in ("id", "time", "changes")}, stamp)
        if not changes and not notice:
            raise ApiError(400, "Нечего публиковать")

        def op(feed: dict) -> dict:
            # новое изменение того же занятия в ту же дату заменяет прежнее
            slots = {(c["lesson"], c["date"]) for c in changes if c["lesson"]}
            replaced = [c["id"] for c in feed["changes"] if (c.get("lesson"), c["date"]) in slots]
            feed["changes"] = [c for c in feed["changes"] if c["id"] not in replaced] + changes
            if notice:
                notice["changes"] = [c["id"] for c in changes]
                for c in changes:
                    c["notice"] = notice["id"]
                feed["notices"].append(notice)
            return {"replaced": replaced}, describe(changes, notice)

        return self._modify(op)

    def revert(self, change_id: str) -> dict:
        def op(feed: dict):
            c = next((x for x in feed["changes"] if x["id"] == change_id), None)
            if not c:
                raise ApiError(404, "Это изменение уже убрано")
            feed["changes"].remove(c)
            return {}, f"вернули как было — {c['subject']}, {_dm(c['date'])}"

        return self._modify(op)

    def delete_notice(self, notice_id: str) -> dict:
        def op(feed: dict):
            n = next((x for x in feed["notices"] if x["id"] == notice_id), None)
            if not n:
                raise ApiError(404, "Это объявление уже убрано")
            feed["notices"].remove(n)
            for c in feed["changes"]:
                if c.get("notice") == notice_id:
                    del c["notice"]
            return {}, f"убрали объявление «{n['title']}»"

        return self._modify(op)

    # ---------------------------------------------------------------- маршруты панели
    def handle(self, method: str, route: str, body: bytes) -> tuple[int, object]:
        try:
            data = json.loads(body.decode("utf-8")) if body else {}
            if not isinstance(data, dict):
                raise ValueError
        except ValueError:
            return 400, {"error": "Неверный JSON"}
        try:
            if method == "GET" and route == "state":
                feed = self.sync()
                return 200, {"feed": feed, "publishing": self.publishing()}
            if method == "POST" and route == "publish":
                return 200, self.publish(data)
            if method == "POST" and route == "revert":
                return 200, self.revert(str(data.get("id") or ""))
            if method == "POST" and route == "notice/delete":
                return 200, self.delete_notice(str(data.get("id") or ""))
            return 404, {"error": "not found"}
        except ApiError as e:
            return e.status, {"error": str(e)}


# ---------------------------------------------------------------- настройка из командной строки

def _origin_repo() -> str:
    try:
        url = subprocess.run(["git", "remote", "get-url", "origin"], cwd=ROOT, capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""
    m = re.search(r"github\.com[:/]([\w.-]+/[\w.-]+?)(?:\.git)?/?$", url)
    return m.group(1) if m else ""


def _saved_here() -> dict:
    """Изменения, сохранённые на этом компьютере до настройки публикации: спрашиваем, выложить ли их на сайт."""
    feed = read_feed(FEED_FILE)
    prune(feed)
    lines = [f"{KIND_LABEL[c['type']]} — {c['subject']}, {_dm(c['date'])}" for c in feed["changes"]]
    lines += [f"объявление «{n['title']}»" for n in feed["notices"]]
    if not lines:
        return empty_feed()
    print("\nНа этом компьютере уже сохранено (на сайте этого ещё нет):")
    for line in lines:
        print("  •", line)
    if input("Опубликовать это на сайте? [Д/н]: ").strip().lower() in ("", "д", "да", "y", "yes"):
        return feed
    print("  не публикую — лента на сайте будет пустой")
    return empty_feed()


def github_cli(argv: list[str]) -> int:
    import argparse
    import getpass

    ap = argparse.ArgumentParser(prog="python app.py github", description="Публикация изменений учебного отдела на сайт через GitHub")
    ap.add_argument("--off", action="store_true", help="выключить публикацию (удалить сохранённый ключ)")
    args = ap.parse_args(argv)
    cfg_file = DATA / "github.json"
    if args.off:
        cfg_file.unlink(missing_ok=True)
        print("Публикация выключена, ключ удалён.")
        return 0

    old = {}
    try:
        old = json.loads(cfg_file.read_text("utf-8"))
    except (OSError, ValueError):
        pass
    print(f"""Программе нужен ключ доступа к репозиторию с сайтом — только к нему и только к файлам.

  1. Откройте {TOKEN_URL}
     (войдите в аккаунт GitHub, которому принадлежит сайт).
  2. Token name — например «Расписание: учебный отдел».
     Expiration — срок действия (например, 1 год); когда он закончится, панель предупредит.
  3. Repository access → Only select repositories → выберите репозиторий сайта.
  4. Permissions → Repository permissions → Contents → Read and write.
  5. Generate token и скопируйте ключ (github_pat_…).
""")
    default_repo = old.get("repo") or _origin_repo()
    repo = input(f"Репозиторий (владелец/название){f' [{default_repo}]' if default_repo else ''}: ").strip() or default_repo
    branch = input(f"Ветка [{old.get('branch') or 'main'}]: ").strip() or old.get("branch") or "main"
    token = getpass.getpass("Ключ доступа (вставьте — символы не отображаются): ").strip()
    if not token and old.get("token"):
        token = old["token"]
        print("  оставляю прежний ключ")
    cfg = {"repo": repo, "branch": branch, "token": token}
    try:
        gh = GitHub(cfg)
        feed, sha = gh.get()
        if not sha:
            print(f"\nФайла {FEED_REPO_PATH} в репозитории ещё нет — создаю его.")
        if not (feed["changes"] or feed["notices"]):
            # на сайте пусто — предлагаем выложить то, что сохранили на этом компьютере до настройки
            local = _saved_here()
            if not sha or local["changes"] or local["notices"]:
                # новый файл создаём сразу — заодно проверяем, что ключ может сохранять файлы
                local["rev"] = max(int(local.get("rev", 0)), int(feed.get("rev", 0)) + 1)
                gh.put(local, sha, COMMIT_PREFIX + ("лента изменений создана" if not sha else "сохранённое до настройки публикации"))
                feed = local
    except (ValueError, ApiError) as e:
        print(f"\nНе получилось: {e}")
        return 1
    DATA.mkdir(parents=True, exist_ok=True)
    cfg_file.write_text(json.dumps(cfg, ensure_ascii=False, indent=1), "utf-8")
    print(f"\nГотово: доступ к {repo} есть, в ленте сейчас изменений — {len(feed['changes'])}, объявлений — {len(feed['notices'])}.")
    print("Ключ сохранён в", cfg_file, "— не передавайте этот файл другим людям.")
    return 0


def check_cli(argv: list[str]) -> int:
    """python backend.py check site/data/feed.json — проверка ленты перед публикацией сайта."""
    path = Path(argv[0] if argv else FEED_FILE)
    try:
        feed = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError) as e:
        print(f"::error::{path}: {e}")
        return 1
    errors = validate_feed(feed)
    for e in errors:
        print(f"::error::{path}: {e}")
    if not errors:
        print(f"{path}: изменений {len(feed['changes'])}, объявлений {len(feed['notices'])} — всё в порядке")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1:2] == ["check"]:
        sys.exit(check_cli(sys.argv[2:]))
    sys.exit(github_cli(sys.argv[1:]))

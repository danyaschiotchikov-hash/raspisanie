"""Изменения в расписании и уведомления учебного отдела: хранилище, API и рассылка Web Push.

Данные лежат в папке server-data/ (в git не попадает; путь можно задать переменной RASP_DATA):
  admins.json         — сотрудники учебного отдела: логин, имя, хэш пароля
  sessions.json       — входы в панель (хранятся только хэши токенов)
  feed.json           — изменения в расписании и объявления
  subscriptions.json  — браузеры, подписанные на уведомления, и их группы
  vapid_private.pem   — ключ подписи Web Push (создаётся при первом запуске)
  config.json         — необязательно: {"contact": "mailto:…"} для push-сервисов

Изменение (change) относится к одному занятию в одну дату:
  cancel — отменено; change — перенесено или заменены преподаватель / аудитория; add — дополнительное занятие.
Объявление (notice) — текст для выбранных групп (или всех), может ссылаться на изменения.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

try:
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid
    from pywebpush import WebPushException, webpush
    PUSH_LIB = True
except ImportError:  # без pywebpush всё работает, кроме рассылки
    PUSH_LIB = False

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("RASP_DATA") or ROOT / "server-data")
MSK = dt.timezone(dt.timedelta(hours=3))  # Петрозаводск, без перехода на летнее время

SESSION_DAYS = 30
FEED_DAYS = 60            # сколько дней назад изменения и объявления попадают в общую ленту
PUSH_TTL = 2 * 24 * 3600  # сколько push-сервис хранит уведомление, пока телефон не в сети
MAX_SUBSCRIPTIONS = 50000

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def now_msk() -> dt.datetime:
    return dt.datetime.now(MSK).replace(microsecond=0)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _hash_password(password: str, salt: bytes | None = None, rounds: int = 240_000) -> dict:
    salt = salt or secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds)
    return {"salt": salt.hex(), "hash": h.hex(), "rounds": rounds}


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


def _endpoint_ok(url: str) -> bool:
    """Push-адрес браузера: только https и только публичные адреса (сервер не должен ходить во внутреннюю сеть)."""
    u = urlparse(url)
    if u.scheme != "https" or not u.hostname:
        return False
    try:
        ipaddress.ip_address(u.hostname)
        return False
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return False
    return bool(infos) and all(ipaddress.ip_address(i[4][0].split("%")[0]).is_global for i in infos)


# ---------------------------------------------------------------- хранилище

class Backend:
    def __init__(self, root: Path = DATA, log=print):
        self.root = root
        self.log = log
        self.lock = threading.RLock()
        root.mkdir(parents=True, exist_ok=True)
        self.admins: dict = self._read("admins.json", {})
        self.sessions: dict = self._read("sessions.json", {})
        self.feed: dict = self._read("feed.json", {"rev": 0, "changes": [], "notices": []})
        self.subs: dict = self._read("subscriptions.json", {})
        self.config: dict = self._read("config.json", {})
        self.fails: dict[str, list[float]] = {}
        self.pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="push")
        self.vapid_public = ""
        self.vapid_pem = root / "vapid_private.pem"
        if PUSH_LIB:
            try:
                self._init_vapid()
            except Exception as e:  # noqa: BLE001
                self.log(f"  ! Web Push недоступен: {e}")

    # -- файлы
    def _read(self, name: str, default):
        try:
            return json.loads((self.root / name).read_text("utf-8"))
        except FileNotFoundError:
            return default
        except (OSError, ValueError) as e:
            raise RuntimeError(f"Не удалось прочитать {self.root / name}: {e}") from e

    def _write(self, name: str, obj) -> None:
        p = self.root / name
        tmp = p.with_name(p.name + ".tmp")
        tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), "utf-8")
        os.replace(tmp, p)

    def _save_feed(self) -> None:
        self.feed["rev"] = int(self.feed.get("rev", 0)) + 1
        self._write("feed.json", self.feed)

    def _init_vapid(self) -> None:
        if not self.vapid_pem.exists():
            v = Vapid()
            v.generate_keys()
            v.save_key(str(self.vapid_pem))
        v = self.vapid = Vapid.from_file(str(self.vapid_pem))
        raw = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.vapid_public = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    @property
    def push_ready(self) -> bool:
        return bool(self.vapid_public)

    # -- сотрудники учебного отдела
    def set_admin(self, login: str, name: str, password: str) -> None:
        login = login.strip().lower()
        if not re.match(r"^[a-z0-9._-]{2,40}$", login):
            raise ValueError("Логин: латинские буквы, цифры, точка, дефис (2–40 символов)")
        if len(password) < 8:
            raise ValueError("Пароль должен быть не короче 8 символов")
        with self.lock:
            self.admins[login] = {"name": name.strip() or login, **_hash_password(password)}
            self._write("admins.json", self.admins)
            # смена пароля завершает старые входы
            self.sessions = {k: v for k, v in self.sessions.items() if v.get("login") != login}
            self._write("sessions.json", self.sessions)

    def remove_admin(self, login: str) -> bool:
        login = login.strip().lower()
        with self.lock:
            if self.admins.pop(login, None) is None:
                return False
            self._write("admins.json", self.admins)
            self.sessions = {k: v for k, v in self.sessions.items() if v.get("login") != login}
            self._write("sessions.json", self.sessions)
            return True

    def _check_password(self, login: str, password: str) -> dict | None:
        a = self.admins.get(login)
        if not a:
            _hash_password(password)  # одинаковое время ответа для существующих и несуществующих логинов
            return None
        h = _hash_password(password, bytes.fromhex(a["salt"]), a["rounds"])
        return a if hmac.compare_digest(h["hash"], a["hash"]) else None

    def login(self, login: str, password: str, ip: str) -> dict:
        t = time.time()
        with self.lock:
            recent = [x for x in self.fails.get(ip, []) if t - x < 900]
            self.fails[ip] = recent
            if len(recent) >= 8:
                raise ApiError(429, "Слишком много неудачных попыток. Попробуйте через 15 минут")
        login = str(login or "").strip().lower()
        a = self._check_password(login, str(password or ""))
        with self.lock:
            if not a:
                self.fails.setdefault(ip, []).append(t)
                raise ApiError(401, "Неверный логин или пароль")
            token = secrets.token_urlsafe(32)
            exp = int(t + SESSION_DAYS * 86400)
            self.sessions = {k: v for k, v in self.sessions.items() if v.get("exp", 0) > t}
            self.sessions[_hash_token(token)] = {"login": login, "exp": exp}
            self._write("sessions.json", self.sessions)
        return {"token": token, "login": login, "name": a["name"]}

    def auth(self, headers) -> dict | None:
        h = headers.get("Authorization") or ""
        if not h.startswith("Bearer "):
            return None
        s = self.sessions.get(_hash_token(h[7:].strip()))
        if not s or s.get("exp", 0) < time.time() or s.get("login") not in self.admins:
            return None
        return {"login": s["login"], "name": self.admins[s["login"]]["name"]}

    def logout(self, headers) -> None:
        h = headers.get("Authorization") or ""
        with self.lock:
            if self.sessions.pop(_hash_token(h[7:].strip()), None) is not None:
                self._write("sessions.json", self.sessions)

    # -- лента
    def public_feed(self) -> dict:
        today = now_msk().date()
        since_date = (today - dt.timedelta(days=FEED_DAYS)).isoformat()
        since_time = (now_msk() - dt.timedelta(days=FEED_DAYS)).isoformat()
        with self.lock:
            changes = [{k: v for k, v in c.items() if k != "author"} for c in self.feed["changes"]
                       if max(c["date"], (c.get("to") or {}).get("date", "")) >= since_date]
            notices = [{k: v for k, v in n.items() if k not in ("author", "push")} for n in self.feed["notices"]
                       if not n.get("deleted") and n["time"] >= since_time]
            return {"rev": self.feed["rev"], "changes": changes, "notices": notices}

    def history(self) -> dict:
        with self.lock:
            return {"rev": self.feed["rev"], "changes": list(self.feed["changes"]),
                    "notices": [n for n in self.feed["notices"] if not n.get("deleted")][-300:]}

    def _clean_change(self, c: dict, author: str, stamp: str) -> dict:
        kind = c.get("type")
        if kind not in ("cancel", "change", "add"):
            raise ApiError(400, "Неизвестный вид изменения")
        start, end = _slot(c)
        out = {
            "id": "c" + secrets.token_hex(5),
            "type": kind,
            "lesson": _str(c.get("lesson"), 40) if kind != "add" else "",
            "date": _date(c.get("date")),
            "start": start, "end": end,
            "subject": _str(c.get("subject"), 200, True, "дисциплина"),
            "teachers": _list(c.get("teachers"), 10, 80),
            "rooms": _list(c.get("rooms"), 10, 80),
            "groups": _list(c.get("groups"), 400, 300),
            "note": _str(c.get("note"), 300),
            "created": stamp, "author": author,
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
        return out

    def _clean_notice(self, n: dict, author: str, stamp: str) -> dict:
        groups = _list(n.get("groups"), 400, 300)
        everyone = bool(n.get("all"))
        if not everyone and not groups:
            raise ApiError(400, "Выберите получателей объявления")
        return {
            "id": "n" + secrets.token_hex(5),
            "time": stamp,
            "title": _str(n.get("title"), 120, True, "заголовок"),
            "body": _str(n.get("body"), 2000, True, "текст"),
            "title_zh": _str(n.get("title_zh"), 120),
            "body_zh": _str(n.get("body_zh"), 2000),
            "groups": [] if everyone else groups,
            "all": everyone,
            "changes": [],
            "author": author,
        }

    def publish(self, payload: dict, user: dict) -> dict:
        """Сохраняет изменения и объявление; рассылка push идёт в фоне."""
        raw_changes = payload.get("changes") or []
        if not isinstance(raw_changes, list) or len(raw_changes) > 300:
            raise ApiError(400, "Слишком много изменений за раз")
        stamp = now_msk().isoformat()
        changes = [self._clean_change(c, user["name"], stamp) for c in raw_changes if isinstance(c, dict)]
        notice = self._clean_notice(payload["notice"], user["name"], stamp) if payload.get("notice") else None
        if not changes and not notice:
            raise ApiError(400, "Нечего публиковать")
        send = bool(notice) and bool(payload.get("push", True))
        with self.lock:
            # новое изменение того же занятия в ту же дату заменяет прежнее
            slots = {(c["lesson"], c["date"]) for c in changes if c["lesson"]}
            replaced = [c["id"] for c in self.feed["changes"] if (c.get("lesson"), c["date"]) in slots]
            self.feed["changes"] = [c for c in self.feed["changes"] if c["id"] not in replaced] + changes
            if notice:
                notice["changes"] = [c["id"] for c in changes]
                for c in changes:
                    c["notice"] = notice["id"]
                if send:
                    notice["push"] = {"state": "queued", "total": 0, "sent": 0, "failed": 0}
                self.feed["notices"].append(notice)
            self._prune()
            self._save_feed()
        if send:
            self.pool.submit(self._broadcast, notice["id"])
        self.log(f"  {user['name']}: изменений {len(changes)}" + (f", объявление «{notice['title']}»" if notice else ""))
        return {"changes": changes, "notice": notice, "replaced": replaced, "push": send and self.push_ready}

    def revert(self, change_id: str, user: dict) -> dict:
        with self.lock:
            left = [c for c in self.feed["changes"] if c["id"] != change_id]
            if len(left) == len(self.feed["changes"]):
                raise ApiError(404, "Изменение не найдено")
            self.feed["changes"] = left
            self._save_feed()
        self.log(f"  {user['name']}: отменено изменение {change_id}")
        return {"ok": True}

    def delete_notice(self, notice_id: str, user: dict) -> dict:
        with self.lock:
            for n in self.feed["notices"]:
                if n["id"] == notice_id:
                    n["deleted"] = now_msk().isoformat()
                    self._save_feed()
                    self.log(f"  {user['name']}: скрыто объявление {notice_id}")
                    return {"ok": True}
        raise ApiError(404, "Объявление не найдено")

    def _prune(self) -> None:
        """Старше года — удаляем, чтобы файл не рос бесконечно."""
        cutoff = (now_msk() - dt.timedelta(days=365)).isoformat()
        self.feed["changes"] = [c for c in self.feed["changes"] if c.get("created", "") >= cutoff]
        self.feed["notices"] = [n for n in self.feed["notices"] if n["time"] >= cutoff]

    # -- подписки
    def subscribe(self, body: dict) -> dict:
        sub = body.get("subscription") or {}
        endpoint = str(sub.get("endpoint") or "")
        keys = sub.get("keys") or {}
        if len(endpoint) > 1000 or not isinstance(keys, dict) or not keys.get("p256dh") or not keys.get("auth"):
            raise ApiError(400, "Неверная подписка")
        if not _endpoint_ok(endpoint):
            raise ApiError(400, "Недопустимый адрес push-сервиса")
        rec = {
            "keys": {"p256dh": _str(keys["p256dh"], 200), "auth": _str(keys["auth"], 100)},
            "groups": _list(body.get("groups"), 10, 300),
            "lang": "zh" if body.get("lang") == "zh" else "ru",
            "updated": now_msk().isoformat(),
        }
        with self.lock:
            if endpoint not in self.subs and len(self.subs) >= MAX_SUBSCRIPTIONS:
                raise ApiError(503, "Достигнут предел подписок")
            old = self.subs.get(endpoint)
            rec["created"] = old.get("created", rec["updated"]) if old else rec["updated"]
            self.subs[endpoint] = rec
            self._write("subscriptions.json", self.subs)
        return {"ok": True}

    def unsubscribe(self, body: dict) -> dict:
        with self.lock:
            if self.subs.pop(str(body.get("endpoint") or ""), None) is not None:
                self._write("subscriptions.json", self.subs)
        return {"ok": True}

    def stats(self) -> dict:
        by_group: dict[str, int] = {}
        with self.lock:
            for s in self.subs.values():
                for g in s.get("groups", []):
                    by_group[g] = by_group.get(g, 0) + 1
            return {"subscribers": len(self.subs), "byGroup": by_group, "push": self.push_ready}

    # -- рассылка
    def _targets(self, notice: dict) -> list[tuple[str, dict]]:
        with self.lock:
            if notice.get("all"):
                return list(self.subs.items())
            wanted = set(notice["groups"])
            return [(ep, s) for ep, s in self.subs.items() if wanted.intersection(s.get("groups", []))]

    def _broadcast(self, notice_id: str) -> None:
        with self.lock:
            notice = next((n for n in self.feed["notices"] if n["id"] == notice_id), None)
        if not notice:
            return
        targets = self._targets(notice) if self.push_ready else []
        stats = {"state": "sending", "total": len(targets), "sent": 0, "failed": 0}
        gone: list[str] = []
        hosts: dict[str, bool] = {}
        for ep, s in targets:
            host = urlparse(ep).hostname or ""
            if host not in hosts:
                hosts[host] = _endpoint_ok(ep)
            if not hosts[host]:
                stats["failed"] += 1
                continue
            zh = s.get("lang") == "zh" and notice.get("title_zh")
            payload = json.dumps({
                "id": notice["id"],
                "title": notice["title_zh"] if zh else notice["title"],
                "body": (notice.get("body_zh") or notice["body"]) if zh else notice["body"],
                "group": (s.get("groups") or [""])[0],
            }, ensure_ascii=False)
            try:
                webpush(
                    subscription_info={"endpoint": ep, "keys": s["keys"]},
                    data=payload,
                    vapid_private_key=self.vapid,
                    # новый словарь на каждый адрес: pywebpush дописывает в него aud своего push-сервиса
                    vapid_claims={"sub": self.config.get("contact") or "mailto:noreply@glazunovcons.ru"},
                    ttl=PUSH_TTL,
                    headers={"Urgency": "high"},
                    timeout=20,
                )
                stats["sent"] += 1
            except WebPushException as e:
                stats["failed"] += 1
                code = e.response.status_code if e.response is not None else 0
                if code in (404, 410):
                    gone.append(ep)  # браузер отписался или переустановлен
                else:
                    self.log(f"  ! push {host}: {code or e}")
            except Exception as e:  # noqa: BLE001
                stats["failed"] += 1
                self.log(f"  ! push {host}: {e}")
        stats["state"] = "done" if self.push_ready else "disabled"
        with self.lock:
            for ep in gone:
                self.subs.pop(ep, None)
            if gone:
                self._write("subscriptions.json", self.subs)
            for n in self.feed["notices"]:
                if n["id"] == notice_id:
                    n["push"] = stats
            self._write("feed.json", self.feed)  # без смены rev: для читателей ленты ничего не изменилось
        self.log(f"  push «{notice['title']}»: доставлено {stats['sent']} из {stats['total']}")

    # ---------------------------------------------------------------- маршруты
    def handle(self, method: str, path: str, headers, body: bytes, ip: str) -> tuple[int, object, dict]:
        """Возвращает (код, JSON-объект или None, доп. заголовки)."""
        try:
            data = json.loads(body.decode("utf-8")) if body else {}
            if not isinstance(data, dict):
                raise ValueError
        except ValueError:
            return 400, {"error": "Неверный JSON"}, {}
        try:
            return self._route(method, path, headers, data, ip)
        except ApiError as e:
            return e.status, {"error": str(e)}, {}

    def _route(self, method, path, headers, data, ip):
        if method == "GET" and path == "/api/feed":
            etag = f'"{self.feed["rev"]}"'
            if headers.get("If-None-Match") == etag:
                return 304, None, {"ETag": etag}
            return 200, self.public_feed(), {"ETag": etag}
        if method == "GET" and path == "/api/push/key":
            return 200, {"key": self.vapid_public, "push": self.push_ready}, {}
        if method == "POST" and path == "/api/push/subscribe":
            return 200, self.subscribe(data), {}
        if method == "POST" and path == "/api/push/unsubscribe":
            return 200, self.unsubscribe(data), {}
        if method == "POST" and path == "/api/login":
            return 200, self.login(data.get("login"), data.get("password"), ip), {}

        if path.startswith("/api/admin/"):
            user = self.auth(headers)
            if not user:
                return 401, {"error": "Войдите заново"}, {}
            route = path[len("/api/admin/"):]
            if method == "GET" and route == "me":
                return 200, user, {}
            if method == "POST" and route == "logout":
                self.logout(headers)
                return 200, {"ok": True}, {}
            if method == "GET" and route == "history":
                return 200, {**self.history(), **self.stats()}, {}
            if method == "GET" and route == "stats":
                return 200, self.stats(), {}
            if method == "POST" and route == "publish":
                return 200, self.publish(data, user), {}
            if method == "POST" and route == "revert":
                return 200, self.revert(str(data.get("id") or ""), user), {}
            if method == "POST" and route == "notice/delete":
                return 200, self.delete_notice(str(data.get("id") or ""), user), {}
        return 404, {"error": "not found"}, {}


# ---------------------------------------------------------------- управление сотрудниками из командной строки

def admin_cli(argv: list[str]) -> int:
    import argparse
    import getpass

    ap = argparse.ArgumentParser(prog="python app.py admin", description="Сотрудники учебного отдела")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add", help="добавить сотрудника или сменить пароль")
    a.add_argument("login", help="логин латиницей, например ivanova")
    a.add_argument("name", nargs="?", default="", help="имя для истории изменений, например «Иванова А.А.»")
    sub.add_parser("list", help="список сотрудников")
    r = sub.add_parser("remove", help="удалить сотрудника")
    r.add_argument("login")
    args = ap.parse_args(argv)

    b = Backend(log=lambda *_: None)
    if args.cmd == "list":
        if not b.admins:
            print("Сотрудников пока нет. Добавьте: python app.py admin add <логин> \"Имя\"")
        for login, x in sorted(b.admins.items()):
            print(f"  {login:20} {x['name']}")
        return 0
    if args.cmd == "remove":
        print("Удалён." if b.remove_admin(args.login) else "Такого логина нет.")
        return 0
    pw = getpass.getpass("Пароль (не короче 8 символов): ")
    if pw != getpass.getpass("Повторите пароль: "):
        print("Пароли не совпадают.")
        return 1
    name = args.name or b.admins.get(args.login.lower(), {}).get("name", "")
    try:
        b.set_admin(args.login, name, pw)
    except ValueError as e:
        print(e)
        return 1
    print(f"Готово: {args.login.lower()} может входить в панель учебного отдела (admin.html).")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(admin_cli(sys.argv[1:]))

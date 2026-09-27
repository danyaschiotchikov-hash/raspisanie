package app.raspisanie;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Данные для виджета: скачивает расписание с сайта (с кэшем) и собирает строки на сегодня или на неделю. */
final class ScheduleData {
    static final String PREFS = "raspisanie";
    private static final long MAX_AGE_MS = 3L * 60 * 60 * 1000;

    private static final String[] DAYS_RU = {"Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"};
    private static final String[] DAYS_ZH = {"星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"};
    private static final String[] MONTHS_RU = {"января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
            "сентября", "октября", "ноября", "декабря"};

    static final class Row {
        boolean header;
        String text;
        String start = "";
        String end = "";
        String title = "";
        String meta = "";
        boolean personal;
        boolean now;
        boolean past;
    }

    private ScheduleData() {
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONObject config(Context c) {
        try {
            return new JSONObject(prefs(c).getString("config", "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    static boolean configured(JSONObject cfg) {
        return !cfg.isNull("groupKey") && !cfg.optString("groupKey", "").isEmpty();
    }

    static boolean zh(JSONObject cfg) {
        return "zh".equals(cfg.optString("lang", "ru"));
    }

    static boolean weekMode(Context c) {
        return prefs(c).getBoolean("week", false);
    }

    /** «Понедельник, 28 сентября» / «9月28日 星期一». */
    static String dayTitle(LocalDate d, boolean zh) {
        int dow = d.getDayOfWeek().getValue() - 1;
        if (zh) return d.getMonthValue() + "月" + d.getDayOfMonth() + "日 " + DAYS_ZH[dow];
        return DAYS_RU[dow] + ", " + d.getDayOfMonth() + " " + MONTHS_RU[d.getMonthValue() - 1];
    }

    static List<Row> compute(Context c) {
        List<Row> rows = new ArrayList<>();
        JSONObject cfg = config(c);
        if (!configured(cfg)) return rows;
        boolean zh = zh(cfg);
        JSONObject tr = cfg.optJSONObject("tr");
        if (tr == null) tr = new JSONObject();

        String dataUrl = cfg.isNull("dataUrl") ? "" : cfg.optString("dataUrl", "");
        if (dataUrl.isEmpty()) dataUrl = BuildConfig.SITE_URL + "data/schedule.json";
        JSONObject data = load(c, dataUrl);

        // занятия выбранной группы
        List<JSONObject> lessons = new ArrayList<>();
        if (data != null) {
            String key = cfg.optString("groupKey");
            String gid = null;
            JSONArray groups = data.optJSONArray("groups");
            if (groups != null) {
                for (int i = 0; i < groups.length() && gid == null; i++) {
                    JSONObject g = groups.optJSONObject(i);
                    if (g != null && key.equals(g.optString("key"))) gid = g.optString("id");
                }
            }
            JSONArray all = data.optJSONArray("lessons");
            if (gid != null && all != null) {
                for (int i = 0; i < all.length(); i++) {
                    JSONObject l = all.optJSONObject(i);
                    JSONArray gs = l == null ? null : l.optJSONArray("groups");
                    if (gs == null) continue;
                    for (int j = 0; j < gs.length(); j++) {
                        if (gid.equals(gs.optString(j))) {
                            lessons.add(l);
                            break;
                        }
                    }
                }
            }
        }
        JSONArray personal = cfg.optJSONArray("personal");

        boolean week = weekMode(c);
        LocalDate today = LocalDate.now();
        LocalTime nowT = LocalTime.now();
        for (int k = 0; k < (week ? 7 : 1); k++) {
            LocalDate d = today.plusDays(k);
            int dow = d.getDayOfWeek().getValue() - 1;
            List<Row> items = new ArrayList<>();

            for (JSONObject l : lessons) {
                if (l.optInt("day", -1) != dow) continue;
                Row r = new Row();
                r.start = l.optString("start");
                r.end = l.optString("end");
                String subject = l.optString("subject");
                r.title = zh ? tr.optString(subject, subject) : subject;
                List<String> meta = new ArrayList<>();
                String teachers = join(l.optJSONArray("teachers"), null);
                if (!teachers.isEmpty()) meta.add(teachers);
                String rooms = join(l.optJSONArray("rooms"), zh ? tr : null);
                if (!rooms.isEmpty()) meta.add(rooms);
                r.meta = String.join(" · ", meta);
                items.add(r);
            }
            if (personal != null) {
                for (int i = 0; i < personal.length(); i++) {
                    JSONObject p = personal.optJSONObject(i);
                    if (p == null || !occurs(p, d)) continue;
                    Row r = new Row();
                    r.start = p.optString("start");
                    r.end = p.optString("end");
                    r.title = p.optString("title");
                    r.meta = p.optString("place", "");
                    r.personal = true;
                    items.add(r);
                }
            }
            items.sort(Comparator.comparing((Row r) -> r.start).thenComparing(r -> r.end));

            if (k == 0) {
                for (Row r : items) {
                    LocalTime s = time(r.start), e = time(r.end);
                    if (s == null || e == null) continue;
                    r.now = !nowT.isBefore(s) && nowT.isBefore(e);
                    r.past = !nowT.isBefore(e);
                }
            }
            if (week) {
                if (items.isEmpty()) continue;
                Row h = new Row();
                h.header = true;
                String rel = k == 0 ? (zh ? " · 今天" : " · сегодня") : k == 1 ? (zh ? " · 明天" : " · завтра") : "";
                h.text = dayTitle(d, zh) + rel;
                rows.add(h);
            }
            rows.addAll(items);
        }
        return rows;
    }

    /** Повторение личного занятия — та же логика, что и на сайте (app.js → occurs). */
    static boolean occurs(JSONObject p, LocalDate d) {
        String start = p.optString("date", "");
        if (start.isEmpty()) return false;
        String ds = d.toString();
        if (ds.compareTo(start) < 0) return false;
        String until = p.isNull("until") ? "" : p.optString("until", "");
        if (!until.isEmpty() && ds.compareTo(until) > 0) return false;
        JSONArray skip = p.optJSONArray("skip");
        if (skip != null) {
            for (int i = 0; i < skip.length(); i++) if (ds.equals(skip.optString(i))) return false;
        }
        LocalDate d0;
        try {
            d0 = LocalDate.parse(start);
        } catch (Exception e) {
            return false;
        }
        long diff = ChronoUnit.DAYS.between(d0, d);
        switch (p.optString("repeat", "none")) {
            case "daily":
                return true;
            case "weekdays":
                return d.getDayOfWeek().getValue() <= 5;
            case "weekly":
                return diff % 7 == 0;
            case "biweekly":
                return diff % 14 == 0;
            case "monthly":
                return d.getDayOfMonth() == d0.getDayOfMonth();
            default:
                return diff == 0;
        }
    }

    private static String join(JSONArray a, JSONObject tr) {
        if (a == null) return "";
        List<String> out = new ArrayList<>();
        for (int i = 0; i < a.length(); i++) {
            String s = a.optString(i);
            if (tr != null) s = tr.optString(s, s);
            out.add(s);
        }
        return String.join(", ", out);
    }

    private static LocalTime time(String hhmm) {
        try {
            return LocalTime.parse(hhmm);
        } catch (Exception e) {
            return null;
        }
    }

    /** schedule.json: с сайта не чаще раза в 3 часа (или по кнопке «обновить»), иначе — из кэша. */
    private static JSONObject load(Context c, String url) {
        File f = new File(c.getFilesDir(), "schedule.json");
        SharedPreferences sp = prefs(c);
        long last = sp.getLong("fetched", 0);
        long force = sp.getLong("force", 0);
        boolean stale = !f.exists() || force > last || System.currentTimeMillis() - last > MAX_AGE_MS;
        if (stale) {
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL(url).openConnection();
                con.setConnectTimeout(8000);
                con.setReadTimeout(15000);
                con.setUseCaches(false);
                if (con.getResponseCode() == 200) {
                    byte[] body = readAll(con.getInputStream());
                    new JSONObject(new String(body, StandardCharsets.UTF_8)); // проверка целостности
                    File tmp = new File(c.getFilesDir(), "schedule.json.tmp");
                    try (FileOutputStream out = new FileOutputStream(tmp)) {
                        out.write(body);
                    }
                    if (tmp.renameTo(f)) sp.edit().putLong("fetched", System.currentTimeMillis()).apply();
                }
            } catch (Exception ignored) {
                // нет сети — покажем сохранённую копию
            } finally {
                if (con != null) con.disconnect();
            }
        }
        if (!f.exists()) return null;
        try (FileInputStream in = new FileInputStream(f)) {
            return new JSONObject(new String(readAll(in), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[16384];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        in.close();
        return buf.toByteArray();
    }
}

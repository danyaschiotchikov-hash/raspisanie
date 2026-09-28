package app.raspisanie;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Изменения от учебного отдела. Своего сервера у расписания нет: приложение само скачивает ленту
 * data/feed.json с сайта и показывает уведомление, если для «моей группы» появилось что-то новое.
 */
final class FeedCheck {
    static final String CHANNEL = "changes";
    private static final String FILE = "feed.json";
    private static final long MAX_AGE_MS = 15L * 60 * 1000;
    private static final Object LOCK = new Object();

    private static final String[] DAYS_RU = {"пн", "вт", "ср", "чт", "пт", "сб", "вс"};
    private static final String[] MONTHS_RU = {"янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"};
    /** Типовые причины из панели учебного отдела (как в i18n.js на сайте). */
    private static final Map<String, String> REASONS_ZH = new HashMap<>();

    static {
        REASONS_ZH.put("Болезнь преподавателя", "教师生病");
        REASONS_ZH.put("Командировка преподавателя", "教师出差");
        REASONS_ZH.put("Концерт или мероприятие", "音乐会或活动");
        REASONS_ZH.put("Праздничный день", "节假日");
        REASONS_ZH.put("По просьбе преподавателя", "应教师要求");
        REASONS_ZH.put("Технические причины", "技术原因");
    }

    private FeedCheck() {
    }

    /** Проверка в фоне (FeedJob): скачать ленту, если она изменилась, и сообщить о новом. */
    static void run(Context c) {
        synchronized (LOCK) {
            SharedPreferences sp = ScheduleData.prefs(c);
            JSONObject cfg = ScheduleData.config(c);
            String url = cfg.isNull("feedUrl") ? "" : cfg.optString("feedUrl", "");
            if (url.isEmpty()) url = BuildConfig.SITE_URL + "data/feed.json";
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL(url).openConnection();
                con.setConnectTimeout(8000);
                con.setReadTimeout(15000);
                con.setUseCaches(false);
                con.setRequestProperty("Cache-Control", "no-cache");
                String etag = sp.getString("feedEtag", "");
                if (!etag.isEmpty() && file(c).exists()) con.setRequestProperty("If-None-Match", etag);
                int code = con.getResponseCode();
                sp.edit().putLong("feedChecked", System.currentTimeMillis()).apply();
                if (code != 200) return; // 304 — ничего не изменилось
                String raw = new String(ScheduleData.readAll(con.getInputStream()), StandardCharsets.UTF_8);
                JSONObject feed = new JSONObject(raw);
                String tag = con.getHeaderField("ETag");
                sp.edit().putString("feedEtag", tag == null ? "" : tag).apply();
                apply(c, feed, raw, true);
            } catch (Exception ignored) {
                // нет сети — проверим в следующий раз
            } finally {
                if (con != null) con.disconnect();
            }
        }
    }

    /** Лента, которую сайт только что показал в приложении: запоминаем без уведомлений. */
    static void seen(Context c, String raw) {
        synchronized (LOCK) {
            try {
                apply(c, new JSONObject(raw), raw, false);
            } catch (Exception ignored) {
                // повреждённые данные — дождёмся следующей проверки
            }
        }
    }

    /** Сохранённая лента для виджета; если давно не проверяли — сначала проверяем. */
    static JSONObject load(Context c, boolean force) {
        SharedPreferences sp = ScheduleData.prefs(c);
        long last = sp.getLong("feedChecked", 0);
        if (force || System.currentTimeMillis() - last > MAX_AGE_MS) run(c);
        String raw = read(c);
        if (raw.isEmpty()) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    static boolean allowed(Context c) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        return nm != null && nm.areNotificationsEnabled();
    }

    /** Канал уведомлений; повторный вызов обновляет название под язык приложения. */
    static void ensureChannel(Context c, boolean zh) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, zh ? "课表变更" : "Изменения в расписании",
                NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(zh ? "教务处发布的停课、调课和通知" : "Отмены, переносы и объявления учебного отдела");
        nm.createNotificationChannel(ch);
    }

    private static void apply(Context c, JSONObject feed, String raw, boolean notify) {
        JSONArray changes = feed.optJSONArray("changes");
        JSONArray notices = feed.optJSONArray("notices");
        if (changes == null || notices == null) return;
        if (!raw.equals(read(c))) {
            write(c, raw);
            ScheduleWidget.refreshAll(c); // виджет покажет отмены и переносы
        }

        SharedPreferences sp = ScheduleData.prefs(c);
        boolean first = !sp.contains("seen"); // первая проверка после установки — только запоминаем
        Set<String> seen = new HashSet<>(sp.getStringSet("seen", new HashSet<>()));
        Set<String> current = new HashSet<>();
        JSONObject cfg = ScheduleData.config(c);
        String group = cfg.isNull("notifyGroup") ? "" : cfg.optString("notifyGroup", "");
        String today = LocalDate.now().toString();

        List<JSONObject> newNotices = new ArrayList<>();
        Set<String> covered = new HashSet<>(); // изменения, о которых уже говорит новое объявление
        for (int i = 0; i < notices.length(); i++) {
            JSONObject n = notices.optJSONObject(i);
            if (n == null) continue;
            String id = n.optString("id");
            current.add(id);
            if (group.isEmpty() || seen.contains(id)) continue;
            if (n.optBoolean("all") || has(n.optJSONArray("groups"), group)) {
                newNotices.add(n);
                JSONArray ids = n.optJSONArray("changes");
                for (int j = 0; ids != null && j < ids.length(); j++) covered.add(ids.optString(j));
            }
        }
        List<JSONObject> newChanges = new ArrayList<>();
        for (int i = 0; i < changes.length(); i++) {
            JSONObject ch = changes.optJSONObject(i);
            if (ch == null) continue;
            String id = ch.optString("id");
            current.add(id);
            if (group.isEmpty() || seen.contains(id) || covered.contains(id)) continue;
            if (!has(ch.optJSONArray("groups"), group)) continue;
            JSONObject to = ch.optJSONObject("to");
            String last = ch.optString("date");
            if (to != null && to.optString("date").compareTo(last) > 0) last = to.optString("date");
            if (last.compareTo(today) < 0) continue; // уже прошло
            newChanges.add(ch);
        }
        sp.edit().putStringSet("seen", current).apply();
        if (!notify || first || (newNotices.isEmpty() && newChanges.isEmpty()) || !allowed(c)) return;
        post(c, cfg, newNotices, newChanges);
    }

    private static void post(Context c, JSONObject cfg, List<JSONObject> notices, List<JSONObject> changes) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        boolean zh = ScheduleData.zh(cfg);
        JSONObject tr = cfg.optJSONObject("tr");
        if (tr == null) tr = new JSONObject();
        ensureChannel(c, zh);
        Intent intent = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent open = PendingIntent.getActivity(c, 10, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        for (JSONObject n : notices) {
            String title = n.optString("title");
            String body = n.optString("body");
            if (zh && !n.optString("title_zh").isEmpty()) {
                title = n.optString("title_zh");
                if (!n.optString("body_zh").isEmpty()) body = n.optString("body_zh");
            }
            nm.notify(("n" + n.optString("id")).hashCode(), build(c, title, body, open));
        }
        if (!changes.isEmpty()) {
            List<String> lines = new ArrayList<>();
            StringBuilder ids = new StringBuilder("c");
            for (JSONObject ch : changes) {
                lines.add(line(ch, zh, tr));
                ids.append(ch.optString("id"));
            }
            String title = changes.size() == 1
                    ? (zh ? "课表变更" : "Изменение в расписании")
                    : (zh ? "课表变更（" + changes.size() + "）" : "Изменения в расписании (" + changes.size() + ")");
            nm.notify(ids.toString().hashCode(), build(c, title, String.join("\n", lines), open));
        }
    }

    private static Notification build(Context c, String title, String text, PendingIntent open) {
        return new Notification.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(c.getColor(R.color.w_head))
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(open)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_EVENT)
                .build();
    }

    /** «Отменено: Сольфеджио, пн 5 окт, 10:00 (Болезнь преподавателя)». */
    static String line(JSONObject ch, boolean zh, JSONObject tr) {
        String subject = ch.optString("subject");
        if (zh) subject = tr.optString(subject, subject);
        String when = when(ch.optString("date"), ch.optString("start"), zh);
        JSONObject to = ch.optJSONObject("to");
        String s;
        switch (ch.optString("type")) {
            case "cancel":
                s = (zh ? "已取消：" : "Отменено: ") + subject + (zh ? "，" : ", ") + when;
                break;
            case "add":
                s = (zh ? "加课：" : "Доп. занятие: ") + subject + (zh ? "，" : ", ") + when;
                break;
            default:
                if (to != null && moved(ch, to)) {
                    s = (zh ? "调课：" : "Перенесено: ") + subject + (zh ? "，" : ", ") + when
                            + " → " + when(to.optString("date"), to.optString("start"), zh);
                } else {
                    String who = to == null ? "" : ScheduleData.join(to.optJSONArray("teachers"), null);
                    String where = to == null ? "" : ScheduleData.join(to.optJSONArray("rooms"), zh ? tr : null);
                    s = (zh ? "变更：" : "Изменение: ") + subject + (zh ? "，" : ", ") + when
                            + (zh ? "，" : " — ") + String.join(zh ? "，" : ", ", nonEmpty(who, where));
                }
        }
        String note = ch.optString("note", "");
        if (zh) note = reasonZh(note);
        if (!note.isEmpty()) s += zh ? "（" + note + "）" : " (" + note + ")";
        return s;
    }

    static String reasonZh(String note) {
        String zh = REASONS_ZH.get(note);
        return zh == null ? note : zh;
    }

    static boolean moved(JSONObject ch, JSONObject to) {
        return !to.optString("date").equals(ch.optString("date"))
                || !to.optString("start").equals(ch.optString("start"))
                || !to.optString("end").equals(ch.optString("end"));
    }

    /** «пн 5 окт, 10:00» / «10月5日 10:00». */
    static String when(String date, String start, boolean zh) {
        try {
            LocalDate d = LocalDate.parse(date);
            if (zh) return d.getMonthValue() + "月" + d.getDayOfMonth() + "日 " + start;
            return DAYS_RU[d.getDayOfWeek().getValue() - 1] + " " + d.getDayOfMonth() + " "
                    + MONTHS_RU[d.getMonthValue() - 1] + ", " + start;
        } catch (Exception e) {
            return date + " " + start;
        }
    }

    static boolean has(JSONArray a, String value) {
        for (int i = 0; a != null && i < a.length(); i++) if (value.equals(a.optString(i))) return true;
        return false;
    }

    private static List<String> nonEmpty(String... items) {
        List<String> out = new ArrayList<>();
        for (String s : items) if (s != null && !s.isEmpty()) out.add(s);
        return out;
    }

    private static File file(Context c) {
        return new File(c.getFilesDir(), FILE);
    }

    private static String read(Context c) {
        File f = file(c);
        if (!f.exists()) return "";
        try (FileInputStream in = new FileInputStream(f)) {
            return new String(ScheduleData.readAll(in), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    private static void write(Context c, String raw) {
        File tmp = new File(c.getFilesDir(), FILE + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(raw.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return;
        }
        if (!tmp.renameTo(file(c))) tmp.delete();
    }
}

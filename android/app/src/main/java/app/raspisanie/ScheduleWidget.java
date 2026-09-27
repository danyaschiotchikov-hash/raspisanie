package app.raspisanie;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.time.LocalDate;

/** Виджет «Сегодня / Неделя» на главном экране. */
public class ScheduleWidget extends AppWidgetProvider {
    static final String ACTION_TOGGLE = "app.raspisanie.action.TOGGLE";
    static final String ACTION_REFRESH = "app.raspisanie.action.REFRESH";

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, build(c, id));
        m.notifyAppWidgetViewDataChanged(ids, R.id.list);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);
        String action = intent.getAction();
        if (ACTION_TOGGLE.equals(action)) {
            SharedPreferences p = ScheduleData.prefs(c);
            p.edit().putBoolean("week", !p.getBoolean("week", false)).apply();
            refreshAll(c);
        } else if (ACTION_REFRESH.equals(action)) {
            ScheduleData.prefs(c).edit().putLong("force", System.currentTimeMillis()).apply();
            refreshAll(c);
        }
    }

    static void refreshAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, ScheduleWidget.class));
        if (ids == null || ids.length == 0) return;
        for (int id : ids) m.updateAppWidget(id, build(c, id));
        m.notifyAppWidgetViewDataChanged(ids, R.id.list);
    }

    static RemoteViews build(Context c, int id) {
        JSONObject cfg = ScheduleData.config(c);
        boolean zh = ScheduleData.zh(cfg);
        boolean week = ScheduleData.weekMode(c);
        boolean configured = ScheduleData.configured(cfg);

        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        v.setTextViewText(R.id.title, week
                ? (zh ? "未来7天" : "Ближайшие 7 дней")
                : (zh ? "今天 · " : "Сегодня · ") + ScheduleData.dayTitle(LocalDate.now(), zh));
        String group = cfg.isNull("groupTitle") ? "" : cfg.optString("groupTitle", "");
        v.setTextViewText(R.id.subtitle, configured && !group.isEmpty() ? group : (zh ? "课程表" : "Расписание"));
        v.setTextViewText(R.id.toggle, week ? (zh ? "今天" : "Сегодня") : (zh ? "一周" : "Неделя"));
        v.setTextViewText(R.id.empty, !configured
                ? (zh ? "打开应用并选择您的班级" : "Откройте приложение и выберите свою группу")
                : week ? (zh ? "未来一周没有课" : "На неделе занятий нет")
                : (zh ? "今天没有课" : "Сегодня занятий нет"));

        Intent svc = new Intent(c, WidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.list, svc);
        v.setEmptyView(R.id.list, R.id.empty);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        v.setOnClickPendingIntent(R.id.toggle, PendingIntent.getBroadcast(c, 1,
                new Intent(c, ScheduleWidget.class).setAction(ACTION_TOGGLE), flags));
        v.setOnClickPendingIntent(R.id.refresh, PendingIntent.getBroadcast(c, 2,
                new Intent(c, ScheduleWidget.class).setAction(ACTION_REFRESH), flags));
        PendingIntent open = PendingIntent.getActivity(c, 3, new Intent(c, MainActivity.class), flags);
        v.setOnClickPendingIntent(R.id.head_text, open);
        v.setOnClickPendingIntent(R.id.empty, open);
        v.setPendingIntentTemplate(R.id.list, PendingIntent.getActivity(c, 4, new Intent(c, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
        return v;
    }
}

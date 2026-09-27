package app.raspisanie;

import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.ArrayList;
import java.util.List;

/** Поставляет строки списка виджета. onDataSetChanged выполняется в фоновом потоке — там можно ходить в сеть. */
public class WidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    static final class Factory implements RemoteViewsFactory {
        private final Context c;
        private List<ScheduleData.Row> rows = new ArrayList<>();

        Factory(Context c) {
            this.c = c;
        }

        @Override
        public void onCreate() {
        }

        @Override
        public void onDataSetChanged() {
            rows = ScheduleData.compute(c);
        }

        @Override
        public void onDestroy() {
            rows = new ArrayList<>();
        }

        @Override
        public int getCount() {
            return rows.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            if (position < 0 || position >= rows.size()) return null;
            ScheduleData.Row r = rows.get(position);
            if (r.header) {
                RemoteViews h = new RemoteViews(c.getPackageName(), R.layout.widget_day);
                h.setTextViewText(R.id.day, r.text);
                return h;
            }
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_item);
            v.setTextViewText(R.id.start, r.start);
            v.setTextViewText(R.id.end, r.end);
            v.setTextViewText(R.id.item_title, r.title);
            v.setTextViewText(R.id.item_meta, r.meta);
            v.setViewVisibility(R.id.item_meta, r.meta == null || r.meta.isEmpty() ? View.GONE : View.VISIBLE);
            int bar = c.getColor(r.now ? R.color.w_now : r.personal ? R.color.w_personal : R.color.w_accent);
            v.setInt(R.id.bar, "setBackgroundColor", bar);
            int text = c.getColor(r.past ? R.color.w_muted : R.color.w_text);
            v.setTextColor(R.id.item_title, text);
            v.setTextColor(R.id.start, text);
            v.setOnClickFillInIntent(R.id.item, new Intent());
            return v;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 2;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return false;
        }
    }
}

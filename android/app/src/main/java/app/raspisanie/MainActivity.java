package app.raspisanie;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Приложение — это сайт расписания в WebView; страница передаёт настройки виджету и уведомлениям через мост Android. */
public class MainActivity extends Activity {
    private static final int REQ_NOTIFY = 1;
    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.addJavascriptInterface(new Bridge(this), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String path = u.getPath() == null ? "" : u.getPath();
                boolean own = u.toString().startsWith(BuildConfig.SITE_URL);
                if (own && !path.endsWith(".pdf") && !path.endsWith(".apk")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u)); // PDF и внешние ссылки — в браузере
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        FeedCheck.ensureChannel(this, ScheduleData.zh(ScheduleData.config(this)));
        FeedJob.schedule(this);

        if (state != null) web.restoreState(state);
        else web.loadUrl(BuildConfig.SITE_URL);
    }

    @Override
    protected void onResume() {
        super.onResume();
        notifyPage(); // уведомления могли включить или выключить в настройках Android
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == REQ_NOTIFY) notifyPage();
    }

    /** Сообщает странице, что разрешение на уведомления могло измениться. */
    private void notifyPage() {
        if (web != null) web.evaluateJavascript("window.onAndroidNotify && window.onAndroidNotify()", null);
    }

    /** "on" — уведомления придут; "ask" — можно спросить разрешение; "blocked" — только через настройки. */
    String notifyState() {
        if (FeedCheck.allowed(this)) return "on";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            boolean asked = ScheduleData.prefs(this).getBoolean("notifyAsked", false);
            if (!asked || shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) return "ask";
        }
        return "blocked";
    }

    void requestNotify() {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && "ask".equals(notifyState())) {
                ScheduleData.prefs(this).edit().putBoolean("notifyAsked", true).apply();
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
            } else if (!FeedCheck.allowed(this)) {
                openNotifySettings();
            } else {
                notifyPage();
            }
        });
    }

    void openNotifySettings() {
        try {
            startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
        } catch (Exception ignored) {
        }
    }

    /** Вызывается со страницы: window.Android.saveConfig(json) и другие методы ниже. */
    public static final class Bridge {
        private final MainActivity a;
        private final Context c;

        Bridge(MainActivity a) {
            this.a = a;
            this.c = a.getApplicationContext();
        }

        @JavascriptInterface
        public void saveConfig(String json) {
            if (json == null) return;
            String old = ScheduleData.prefs(c).getString("config", "");
            if (json.equals(old)) return;
            ScheduleData.prefs(c).edit().putString("config", json).apply();
            FeedCheck.ensureChannel(c, ScheduleData.zh(ScheduleData.config(c)));
            ScheduleWidget.refreshAll(c);
        }

        @JavascriptInterface
        public String notifyState() {
            return a.notifyState();
        }

        @JavascriptInterface
        public void requestNotify() {
            a.requestNotify();
        }

        @JavascriptInterface
        public void openNotifySettings() {
            a.runOnUiThread(a::openNotifySettings);
        }

        /** Лента изменений, которую страница только что показала: о ней уже не нужно уведомлять. */
        @JavascriptInterface
        public void feedSeen(String json) {
            if (json != null) FeedCheck.seen(c, json);
        }
    }
}

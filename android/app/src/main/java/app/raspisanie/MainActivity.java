package app.raspisanie;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Приложение — это сайт расписания в WebView; страница передаёт настройки виджету через мост Android. */
public class MainActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.addJavascriptInterface(new Bridge(getApplicationContext()), "Android");
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

        if (state != null) web.restoreState(state);
        else web.loadUrl(BuildConfig.SITE_URL);
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

    /** Вызывается со страницы: window.Android.saveConfig(json). */
    public static final class Bridge {
        private final Context c;

        Bridge(Context c) {
            this.c = c;
        }

        @JavascriptInterface
        public void saveConfig(String json) {
            if (json == null) return;
            String old = ScheduleData.prefs(c).getString("config", "");
            if (json.equals(old)) return;
            ScheduleData.prefs(c).edit().putString("config", json).apply();
            ScheduleWidget.refreshAll(c);
        }
    }
}

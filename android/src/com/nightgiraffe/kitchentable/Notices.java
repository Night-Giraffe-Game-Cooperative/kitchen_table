package com.nightgiraffe.kitchentable;

import android.content.Context;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

/**
 * Notifications, lent to the page: the switch under Me works as it does in a
 * browser, but it's the app that checks for them and shows them (Inbox). The
 * page calls it as KitchenTableNotifications.
 */
public final class Notices {
    private final MainActivity activity;
    private final Context app;

    Notices(MainActivity activity) {
        this.activity = activity;
        this.app = activity.getApplicationContext();
    }

    /** "on", "off", or "blocked" when Android's settings won't let the app show any and it can't ask. */
    @JavascriptInterface
    public String state() {
        if (Inbox.token(app) != null) return Inbox.allowed(app) ? "on" : "blocked";
        return Inbox.allowed(app) || activity.canAskToNotify() ? "off" : "blocked";
    }

    /** The key it checks with, so opening the app again keeps the same one. */
    @JavascriptInterface
    public String token() {
        String token = Inbox.token(app);
        return token != null ? token : "";
    }

    @JavascriptInterface
    public String endpoint() {
        String endpoint = Inbox.endpoint(app);
        return endpoint != null ? endpoint : "";
    }

    /** What the tablet is called in its settings, like "Pixel 6 Pro", to tell it apart in a list. */
    @JavascriptInterface
    public String model() {
        try {
            String name = Settings.Global.getString(app.getContentResolver(), Settings.Global.DEVICE_NAME);
            if (name != null && !name.trim().isEmpty()) return name.trim();
        } catch (RuntimeException e) {
            // Its model will do.
        }
        return Build.MODEL;
    }

    /** Asks Android's permission if it needs to; the answer comes back to the page as an event. */
    @JavascriptInterface
    public void ask() {
        activity.runOnUiThread(activity::askToNotify);
    }

    @JavascriptInterface
    public void start(String origin, String token, String endpoint) {
        if (origin == null || token == null || token.isEmpty() || endpoint == null || !activity.isHome(origin)) return;
        Inbox.start(app, origin, token, endpoint);
    }

    @JavascriptInterface
    public void stop() {
        Inbox.stop(app);
    }

    @JavascriptInterface
    public void check() {
        new Thread(() -> Inbox.check(app, true), "kitchen-table-inbox").start();
    }

    @JavascriptInterface
    public void clear() {
        Inbox.clear(app);
    }

    @JavascriptInterface
    public void settings() {
        activity.runOnUiThread(activity::openNotificationSettings);
    }
}

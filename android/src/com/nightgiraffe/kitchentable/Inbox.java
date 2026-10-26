package com.nightgiraffe.kitchentable;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/**
 * Kitchen Table's notifications, fetched rather than pushed: a web view has
 * no push service, and the family would rather not go through Google's. The
 * app asks the server what's waiting, with the key it was given when
 * notifications were switched on under Me, and shows it the way a browser
 * would: a chat's messages join up in one notification, and tapping one opens
 * the app at that chat, call or game.
 *
 * It checks about every minute while the app is open, in front or behind
 * (InboxJob, one run after the other), and every 15 minutes or so otherwise,
 * as Android allows, even after the tablet restarts.
 */
final class Inbox {
    static final int EVERY_15_MINUTES = 1;
    static final int SOON = 2;
    static final int SOON_AGAIN = 3;
    static final String OPEN = "com.nightgiraffe.kitchentable.OPEN";

    private static final long MINUTE = 60_000L;
    private static final int HEART = Color.rgb(214, 92, 84);
    private static final String ORIGIN = "inbox-origin";
    private static final String TOKEN = "inbox-token";
    private static final String ENDPOINT = "inbox-endpoint";
    private static final String SEEN = "inbox-seen";
    private static final String PAUSED = "inbox-paused";
    private static final String LINES = "kitchen-table-lines";
    private static final String BUZZED = "kitchen-table-buzzed";

    private static final Object CHECKING = new Object();
    private static final Object SCHEDULING = new Object();

    /** The app's screen is open in this process, in front or behind, so it checks every minute. */
    static volatile boolean alive;
    private static boolean checkingSoon;

    private Inbox() {
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("kitchen-table", Context.MODE_PRIVATE);
    }

    static String token(Context c) {
        return prefs(c).getString(TOKEN, null);
    }

    static String endpoint(Context c) {
        return prefs(c).getString(ENDPOINT, null);
    }

    /** Switched on, and the server hasn't let this device go. */
    static boolean on(Context c) {
        SharedPreferences p = prefs(c);
        return p.getString(TOKEN, null) != null && !p.getBoolean(PAUSED, false);
    }

    /** Whether Android lets the app show notifications at all. */
    static boolean allowed(Context c) {
        NotificationManager n = c.getSystemService(NotificationManager.class);
        return n != null && n.areNotificationsEnabled();
    }

    // Switching on and off

    static void start(Context c, String origin, String token, String endpoint) {
        SharedPreferences p = prefs(c);
        SharedPreferences.Editor e = p.edit().putString(ORIGIN, origin).putString(TOKEN, token).putString(ENDPOINT, endpoint).remove(PAUSED);
        // A new key is a new device to the server, with nothing shown yet.
        if (!token.equals(p.getString(TOKEN, null))) e.remove(SEEN);
        e.apply();
        channels(c);
        everyFifteenMinutes(c);
        keepChecking(c);
    }

    static void stop(Context c) {
        prefs(c).edit().remove(ORIGIN).remove(TOKEN).remove(ENDPOINT).remove(SEEN).remove(PAUSED).apply();
        cancel(c);
        NotificationManager n = c.getSystemService(NotificationManager.class);
        if (n != null) n.cancelAll();
    }

    /** Someone's using the app and sees it all there: clear what's showing, and let what's waiting go. */
    static void clear(final Context c) {
        NotificationManager n = c.getSystemService(NotificationManager.class);
        if (n != null) n.cancelAll();
        new Thread(() -> check(c, false), "kitchen-table-inbox").start();
    }

    // When to check

    private static JobScheduler jobs(Context c) {
        return c.getSystemService(JobScheduler.class);
    }

    private static void everyFifteenMinutes(Context c) {
        JobScheduler jobs = jobs(c);
        if (jobs == null || jobs.getPendingJob(EVERY_15_MINUTES) != null) return;
        schedule(jobs, new JobInfo.Builder(EVERY_15_MINUTES, new ComponentName(c, InboxJob.class))
                .setPeriodic(15 * MINUTE)
                .setPersisted(true)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build());
    }

    /** While the app is open, in front or behind, a check about every minute. */
    static void keepChecking(Context c) {
        synchronized (SCHEDULING) {
            JobScheduler jobs = jobs(c);
            if (!alive || checkingSoon || jobs == null || !on(c)) return;
            if (jobs.getPendingJob(SOON) != null || jobs.getPendingJob(SOON_AGAIN) != null) return;
            soon(c, jobs, SOON);
        }
    }

    static void startedSoon() {
        synchronized (SCHEDULING) {
            checkingSoon = true;
        }
    }

    /** The next check in a minute, under the other number, so this one isn't stopped by the next. */
    static void finishedSoon(Context c, int id) {
        synchronized (SCHEDULING) {
            checkingSoon = false;
            JobScheduler jobs = jobs(c);
            if (alive && jobs != null && on(c)) soon(c, jobs, id == SOON ? SOON_AGAIN : SOON);
        }
    }

    /** The app's screen has closed: back to every 15 minutes or so. */
    static void closed(Context c) {
        synchronized (SCHEDULING) {
            alive = false;
            JobScheduler jobs = jobs(c);
            if (jobs == null) return;
            jobs.cancel(SOON);
            jobs.cancel(SOON_AGAIN);
        }
    }

    private static void soon(Context c, JobScheduler jobs, int id) {
        schedule(jobs, new JobInfo.Builder(id, new ComponentName(c, InboxJob.class))
                .setMinimumLatency(MINUTE)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build());
    }

    private static void schedule(JobScheduler jobs, JobInfo job) {
        try {
            jobs.schedule(job);
        } catch (RuntimeException e) {
            // Android said no (too many jobs, say): opening the app tries again.
            Log.w("KitchenTable", "Couldn't plan a check for notifications", e);
        }
    }

    private static void cancel(Context c) {
        JobScheduler jobs = jobs(c);
        if (jobs == null) return;
        jobs.cancel(EVERY_15_MINUTES);
        jobs.cancel(SOON);
        jobs.cancel(SOON_AGAIN);
    }

    // Checking

    /**
     * Fetches what's waiting and shows it, or, with show false, just lets it
     * go. Never on the main thread: it uses the network.
     */
    static void check(Context c, boolean show) {
        synchronized (CHECKING) {
            SharedPreferences p = prefs(c);
            String origin = p.getString(ORIGIN, null);
            String token = p.getString(TOKEN, null);
            if (origin == null || token == null || p.getBoolean(PAUSED, false)) return;
            // Saying which were shown last time (their ids, like "12,13") lets the server drop them.
            String seen = p.getString(SEEN, "");
            HttpURLConnection http = null;
            try {
                http = (HttpURLConnection) new URL(origin + "/api/push/inbox" + (seen.isEmpty() ? "" : "?seen=" + seen)).openConnection();
                if (http instanceof HttpsURLConnection) trustHome((HttpsURLConnection) http, origin, p.getString("certificate", null));
                http.setInstanceFollowRedirects(false);
                http.setConnectTimeout(15_000);
                http.setReadTimeout(20_000);
                http.setUseCaches(false);
                http.setRequestProperty("Authorization", "Bearer " + token);
                http.setRequestProperty("Accept", "application/json");
                int status = http.getResponseCode();
                boolean same = token.equals(p.getString(TOKEN, null));
                if (status == 401 && same) {
                    // The server has let this device go (signed out, or switched off from
                    // another device): stop asking until the page says otherwise.
                    p.edit().putBoolean(PAUSED, true).apply();
                    cancel(c);
                    return;
                }
                if (status != 200) return;

                JSONArray list = new JSONObject(read(http.getInputStream())).getJSONArray("notifications");
                List<JSONObject> waiting = new ArrayList<>();
                StringBuilder shown = new StringBuilder();
                for (int i = 0; i < list.length(); i++) {
                    JSONObject item = list.getJSONObject(i);
                    waiting.add(item);
                    if (shown.length() > 0) shown.append(',');
                    shown.append(item.optLong("id"));
                }
                if (show && !waiting.isEmpty()) show(c, origin, waiting);
                // The server dropped last time's before answering; these go next time.
                if (token.equals(p.getString(TOKEN, null))) p.edit().putString(SEEN, shown.toString()).apply();
            } catch (Exception e) {
                // Away from home, or the computer's off: the next check tries again.
            } finally {
                if (http != null) http.disconnect();
            }
        }
    }

    private static String read(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int n; (n = in.read(buffer)) != -1; ) {
                out.write(buffer, 0, n);
                if (out.size() > 1_000_000) throw new IOException("That's far more than a few notifications.");
            }
            return out.toString("UTF-8");
        } finally {
            in.close();
        }
    }

    /**
     * At home, Kitchen Table may have a home-made certificate. The web view
     * trusted it the first time it saw it (MainActivity), so the checks trust
     * that same one, and only for an address on the home network.
     */
    private static void trustHome(HttpsURLConnection https, String origin, final String pinned) throws GeneralSecurityException {
        if (pinned == null || !MainActivity.isAtHome(Uri.parse(origin).getHost())) return;
        TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init((KeyStore) null);
        X509TrustManager found = null;
        for (TrustManager t : factory.getTrustManagers()) {
            if (t instanceof X509TrustManager) found = (X509TrustManager) t;
        }
        if (found == null) return;
        final X509TrustManager usual = found;

        X509TrustManager home = new X509TrustManager() {
            @Override
            public void checkClientTrusted(X509Certificate[] chain, String type) throws CertificateException {
                usual.checkClientTrusted(chain, type);
            }

            @Override
            public void checkServerTrusted(X509Certificate[] chain, String type) throws CertificateException {
                try {
                    usual.checkServerTrusted(chain, type);
                } catch (CertificateException e) {
                    if (!isPinned(chain, pinned)) throw e;
                }
            }

            @Override
            public X509Certificate[] getAcceptedIssuers() {
                return usual.getAcceptedIssuers();
            }
        };
        SSLContext tls = SSLContext.getInstance("TLS");
        tls.init(null, new TrustManager[] {home}, null);
        https.setSSLSocketFactory(tls.getSocketFactory());

        final HostnameVerifier usualNames = HttpsURLConnection.getDefaultHostnameVerifier();
        https.setHostnameVerifier((host, session) -> {
            if (usualNames.verify(host, session)) return true;
            try {
                return isPinned(session.getPeerCertificates(), pinned);
            } catch (Exception e) {
                return false;
            }
        });
    }

    private static boolean isPinned(Certificate[] chain, String pinned) {
        try {
            return chain != null && chain.length > 0 && pinned.equals(MainActivity.fingerprint(chain[0].getEncoded()));
        } catch (Exception e) {
            return false;
        }
    }

    // Showing them, as the browser would

    static void channels(Context c) {
        NotificationManager n = c.getSystemService(NotificationManager.class);
        if (n == null) return;
        NotificationChannel chat = new NotificationChannel("messages", "Messages and games", NotificationManager.IMPORTANCE_HIGH);
        chat.setDescription("New messages, your turn in a game, and family news.");
        NotificationChannel calls = new NotificationChannel("calls", "Calls", NotificationManager.IMPORTANCE_HIGH);
        calls.setDescription("Someone calling you.");
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[] {0, 400, 200, 400, 200, 400});
        NotificationChannel days = new NotificationChannel("days", "Morning and evening", NotificationManager.IMPORTANCE_DEFAULT);
        days.setDescription("What's on today, and tomorrow.");
        n.createNotificationChannels(Arrays.asList(chat, calls, days));
    }

    private static void show(Context c, String origin, List<JSONObject> waiting) {
        NotificationManager n = c.getSystemService(NotificationManager.class);
        if (n == null) return;
        channels(c);
        // One notification for each tag (a chat, a call, a game), as in the browser.
        Map<String, List<JSONObject>> byTag = new LinkedHashMap<>();
        for (JSONObject item : waiting) {
            String tag = text(item, "tag");
            if (tag.isEmpty()) tag = "kitchen-table-" + item.optLong("id");
            List<JSONObject> same = byTag.get(tag);
            if (same == null) byTag.put(tag, same = new ArrayList<>());
            same.add(item);
        }
        StatusBarNotification[] showing = n.getActiveNotifications();
        for (Map.Entry<String, List<JSONObject>> e : byTag.entrySet()) {
            StatusBarNotification old = null;
            for (StatusBarNotification s : showing) {
                if (e.getKey().equals(s.getTag())) old = s;
            }
            post(c, n, origin, e.getKey(), e.getValue(), old);
        }
    }

    private static void post(Context c, NotificationManager n, String origin, String tag, List<JSONObject> items, StatusBarNotification old) {
        JSONObject last = items.get(items.size() - 1);
        String kind = text(last, "kind");
        long now = System.currentTimeMillis();
        long at = last.optLong("at", now);

        // A chat's messages join up, newest last, and a quick run of them buzzes once.
        ArrayList<String> lines = new ArrayList<>();
        long buzzed = 0;
        if ("message".equals(kind) && old != null) {
            Bundle before = old.getNotification().extras;
            ArrayList<String> shown = before.getStringArrayList(LINES);
            if (shown != null) lines.addAll(shown);
            buzzed = before.getLong(BUZZED, 0);
        }
        for (JSONObject item : items) {
            // Anything else (a missed call after the ringing, say), the newest says it all.
            if (!"message".equals(text(item, "kind"))) lines.clear();
            String body = text(item, "body");
            if (!body.isEmpty()) lines.add(body);
        }
        while (lines.size() > 5) lines.remove(0);
        boolean quiet = now - buzzed < 30_000;
        if (!quiet) buzzed = now;

        String title = text(last, "title");
        Notification.Builder b = new Notification.Builder(c, channel(kind))
                .setSmallIcon(icon(c))
                .setColor(HEART)
                .setContentTitle(title.isEmpty() ? "Kitchen Table" : title)
                .setContentText(lines.isEmpty() ? "" : lines.get(lines.size() - 1))
                .setWhen(at)
                .setShowWhen(true)
                .setAutoCancel(true)
                .setOnlyAlertOnce(quiet)
                .setCategory(category(kind))
                .setContentIntent(opener(c, origin, tag, text(last, "url")));
        if (lines.size() > 1) {
            Notification.InboxStyle style = new Notification.InboxStyle();
            for (String line : lines) style.addLine(line);
            b.setStyle(style);
        } else if (!lines.isEmpty()) {
            b.setStyle(new Notification.BigTextStyle().bigText(lines.get(0)));
        }
        // A call only rings for so long.
        if ("call".equals(kind)) b.setTimeoutAfter(Math.min(45_000, Math.max(5_000, at + 45_000 - now)));

        Bundle extras = new Bundle();
        extras.putStringArrayList(LINES, lines);
        extras.putLong(BUZZED, buzzed);
        b.addExtras(extras);
        n.notify(tag, 1, b.build());
    }

    /** Tapping one opens the app at its chat, call or game, like "/#/chats/12". */
    private static PendingIntent opener(Context c, String origin, String tag, String url) {
        String hash = url.startsWith("/#/") ? url.substring(1) : "#/";
        Intent open = new Intent(c, MainActivity.class)
                .setAction(OPEN)
                .setData(Uri.parse(origin + "/" + hash))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, tag.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String channel(String kind) {
        if ("call".equals(kind)) return "calls";
        if ("morning".equals(kind) || "evening".equals(kind)) return "days";
        return "messages";
    }

    private static String category(String kind) {
        if ("call".equals(kind)) return Notification.CATEGORY_CALL;
        if ("message".equals(kind)) return Notification.CATEGORY_MESSAGE;
        if ("morning".equals(kind) || "evening".equals(kind)) return Notification.CATEGORY_REMINDER;
        return Notification.CATEGORY_SOCIAL;
    }

    private static int icon(Context c) {
        // This build has no R class, so the heart is found by its name.
        int id = c.getResources().getIdentifier("ic_notify", "drawable", c.getPackageName());
        return id != 0 ? id : android.R.drawable.stat_notify_chat;
    }

    private static String text(JSONObject o, String key) {
        return o.isNull(key) ? "" : o.optString(key, "");
    }
}

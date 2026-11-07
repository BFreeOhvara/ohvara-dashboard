package com.ohvara.portal;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * P880 — the live-transfer push on Android. help-transfer sends it as a data-only FCM message (type
 * transfer_check) so this service can draw it with Yes / No buttons on the high-priority "Live calls" channel,
 * even with the app closed. Yes / No / a tap open the app at ohvara://transfer?check=…&answer=…, where
 * lib/push.js sends the answer (the app holds the sign-in). transfer_clear replaces it ("Answered on your
 * other phone", "No longer available"). Every other push goes to Capacitor's own handling unchanged.
 */
public class TransferMessagingService extends MessagingService {

    static final String CHANNEL = "ohvara_transfer";
    static final int NOTIFY_ID = 880;

    @Override
    public void onMessageReceived(@NonNull RemoteMessage msg) {
        Map<String, String> d = msg.getData();
        String type = d.get("type");
        if ("transfer_check".equals(type)) showCheck(d);
        else if ("transfer_clear".equals(type)) showClear(d);
        // Capacitor still hears every message, so an open app updates at once.
        super.onMessageReceived(msg);
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Live calls", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("A lead is on the line for you. Answer Yes or No within 30 seconds.");
        ch.enableVibration(true);
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        // Do Not Disturb: Android lets only the user allow this ("Override Do Not Disturb" on this channel);
        // the Setup push test sends them to the channel's settings when a test lands silently.
        nm.createNotificationChannel(ch);
    }

    private PendingIntent open(String check, String answer, int code) {
        Uri uri = Uri.parse("ohvara://transfer?check=" + Uri.encode(check) + (answer != null ? "&answer=" + answer : ""));
        Intent i = new Intent(Intent.ACTION_VIEW, uri, this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void showCheck(Map<String, String> d) {
        String check = d.get("check_id");
        if (check == null) return;
        ensureChannel(this);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(d.get("title"))
            .setContentText(d.get("body"))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(d.get("body")))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setTimeoutAfter(30_000)
            .setContentIntent(open(check, null, 1))
            .addAction(0, "Yes", open(check, "yes", 2))
            .addAction(0, "No", open(check, "no", 3));
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(check, NOTIFY_ID, b.build());
        // Seen: the phone showed it. One small POST with the check's own token, off the main thread.
        final String seen = d.get("seen_url");
        if (seen != null && seen.startsWith("https://")) new Thread(() -> ping(seen)).start();
    }

    private void showClear(Map<String, String> d) {
        String check = d.get("check_id");
        if (check == null) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        ensureChannel(this);
        // Same tag + id: the Yes / No alert is replaced, so a stale Yes can't be tapped.
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(d.get("title"))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setAutoCancel(true)
            .setTimeoutAfter(60_000)
            .setContentIntent(open(check, null, 4));
        nm.notify(check, NOTIFY_ID, b.build());
    }

    private static void ping(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            c.setDoOutput(true);
            try (OutputStream o = c.getOutputStream()) { o.write(new byte[0]); }
            c.getResponseCode();
        } catch (Exception ignored) {
            // Seen is a nicety; the answer itself still counts.
        } finally {
            if (c != null) c.disconnect();
        }
    }
}

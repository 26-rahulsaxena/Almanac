package app.almanac.calendar;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.CapConfig;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

// Shows what the server sends (same payload as the website's notifications, see src/lib/push.ts):
// - alarm: the event is starting. Full screen over the lock screen, alarm sound repeating until answered.
// - reminder (has id): a pop-up with Snooze / Done.
// - checkin: Doing it now / Open, or Yes, done / Need 30 more min.
// - anything else (digests): a plain notification that opens the app.
public final class Notify {
    // Channel settings can't change once created on a phone, so a new id is needed to change them.
    static final String ALARM = "alarm-v1";
    static final String REMINDER = "reminder-v1";
    static final String UPDATE = "update-v1";

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel alarm = new NotificationChannel(ALARM, "Alarms when events start", NotificationManager.IMPORTANCE_HIGH);
        alarm.setDescription("Rings until you answer, like an alarm clock.");
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        // USAGE_ALARM plays at alarm volume, so it rings even when the phone is on silent.
        alarm.setSound(sound, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        alarm.enableVibration(true);
        alarm.setVibrationPattern(new long[] { 0, 800, 600, 800, 600 });
        alarm.setBypassDnd(true);
        alarm.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationChannel reminder = new NotificationChannel(REMINDER, "Reminders", NotificationManager.IMPORTANCE_HIGH);
        NotificationChannel update = new NotificationChannel(UPDATE, "Plans and check-ins", NotificationManager.IMPORTANCE_DEFAULT);
        nm.createNotificationChannel(alarm);
        nm.createNotificationChannel(reminder);
        nm.createNotificationChannel(update);
    }

    static void show(Context c, JSONObject d) {
        channels(c);
        String id = d.optString("id", "");
        String kind = d.optString("kind", "reminder");
        String title = d.optString("title", "Almanac");
        String body = d.optString("body", "");
        boolean alarm = d.optBoolean("alarm", false) && !id.isEmpty();
        int nid = (id.isEmpty() ? kind : id).hashCode();

        String path = kind.equals("reminder") ? "/" : kind.equals("review") ? "/?review=1" : "/?priorities=1";
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, alarm ? ALARM : !id.isEmpty() ? REMINDER : UPDATE)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(open(c, path, nid));

        if (!id.isEmpty()) {
            if (kind.equals("checkin") && d.optString("ask").equals("start")) {
                b.addAction(0, "Doing it now", ActionReceiver.intent(c, nid, id, kind, "doing"));
                b.addAction(0, "Open", ActionReceiver.intent(c, nid, id, kind, "open"));
            } else if (kind.equals("checkin")) {
                b.addAction(0, "Yes, done", ActionReceiver.intent(c, nid, id, kind, "done"));
                b.addAction(0, "Need 30 more min", ActionReceiver.intent(c, nid, id, kind, "more"));
            } else {
                b.addAction(0, "Snooze " + d.optInt("snooze", 5) + " min", ActionReceiver.intent(c, nid, id, kind, "snooze"));
                b.addAction(0, "Done", ActionReceiver.intent(c, nid, id, kind, "done"));
            }
        }

        if (alarm) {
            Intent screen = new Intent(c, AlarmActivity.class)
                .putExtra("nid", nid).putExtra("id", id).putExtra("title", title).putExtra("body", body).putExtra("snooze", d.optInt("snooze", 5))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
            PendingIntent full = PendingIntent.getActivity(c, nid, screen, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setFullScreenIntent(full, true)
                .setContentIntent(full)
                .setOngoing(true)
                .setAutoCancel(false)
                .setTimeoutAfter(15 * 60 * 1000); // stops by itself after 15 minutes
        } else if (!id.isEmpty()) {
            b.setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_REMINDER);
        }

        Notification n = b.build();
        if (alarm) n.flags |= Notification.FLAG_INSISTENT; // repeat the sound until answered
        try {
            c.getSystemService(NotificationManager.class).notify(nid, n);
        } catch (SecurityException e) {
            // Notifications not allowed on this phone: nothing to show.
        }
    }

    // Opens the app (at a page of the site).
    static PendingIntent open(Context c, String path, int nid) {
        Intent i = new Intent(c, MainActivity.class).putExtra(MainActivity.PATH, path).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, nid + 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static String server(Context c) {
        String url = CapConfig.loadDefault(c).getServerUrl();
        return url == null ? "" : url.replaceAll("/+$", "");
    }

    // Tells the server what was tapped. The reminder's random id is the permission (see /api/reminders/ack).
    static void answer(Context c, String id, String kind, String action) {
        String path = kind.equals("checkin") ? "/api/priorities/answer" : "/api/reminders/ack";
        try {
            HttpURLConnection con = (HttpURLConnection) new URL(server(c) + path).openConnection();
            con.setRequestMethod("POST");
            con.setConnectTimeout(10000);
            con.setReadTimeout(10000);
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/json");
            byte[] json = new JSONObject().put("id", id).put("action", action).toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = con.getOutputStream()) {
                out.write(json);
            }
            con.getResponseCode();
            con.disconnect();
        } catch (Exception e) {
            // Offline: the server re-sends unanswered reminders anyway.
        }
    }
}

package app.almanac.calendar;

import android.Manifest;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.appcompat.app.AlertDialog;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // A page of the site to open, from a tapped notification ("/?priorities=1").
    static final String PATH = "almanacPath";
    private static final int ASK_NOTIFICATIONS = 7;
    private static final long THREE_DAYS = 3L * 24 * 60 * 60 * 1000;

    @Override
    public void onCreate(Bundle state) {
        registerPlugin(AlmanacPlugin.class);
        super.onCreate(state);
        Notify.channels(this);
        askForAlerts();
        go(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        Notify.register(this); // also right after signing in, when the app comes back from the browser
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        go(intent);
    }

    private void go(Intent intent) {
        String path = intent == null ? null : intent.getStringExtra(PATH);
        if (path == null || path.equals("/") || !path.startsWith("/")) return;
        intent.removeExtra(PATH);
        bridge.getWebView().post(() -> bridge.getWebView().loadUrl(Notify.server(this) + path));
    }

    // On opening: ask Android for notifications (13+ starts with them off), then for full-screen alarms (14+).
    private void askForAlerts() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, ASK_NOTIFICATIONS);
            return;
        }
        afterNotifications();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == ASK_NOTIFICATIONS) afterNotifications();
    }

    private void afterNotifications() {
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) {
            // Refused, or Android won't ask again: offer the app's notification settings instead.
            explain("Turn on reminders", "Almanac can't remind you about events while notifications are off for it.",
                new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
            return;
        }
        Notify.register(this);
        if (Build.VERSION.SDK_INT >= 34 && !getSystemService(NotificationManager.class).canUseFullScreenIntent()) {
            explain("Allow full-screen alarms", "So an event starting rings over your lock screen, like an alarm clock. Switch Almanac on in the next screen.",
                new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getPackageName())));
        } else if (!getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName())) {
            // Battery saving puts the app to sleep, and then reminders arrive late or never (the usual cause of a missed one).
            explain("Keep reminders on time", "Your phone can put Almanac to sleep to save battery, and then reminders come late or not at all. Allow Almanac to run in the background.",
                new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
        }
    }

    // Asks once; "Not now" waits three days before asking again.
    private void explain(String title, String message, Intent settings) {
        SharedPreferences prefs = getSharedPreferences("almanac", MODE_PRIVATE);
        String key = "notNow:" + title;
        if (System.currentTimeMillis() < prefs.getLong(key, 0)) return;
        new AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("Open settings", (d, w) -> {
                try {
                    startActivity(settings);
                } catch (ActivityNotFoundException e) {
                    // This phone has no such screen: nothing to open.
                }
            })
            .setNegativeButton("Not now", (d, w) -> prefs.edit().putLong(key, System.currentTimeMillis() + THREE_DAYS).apply())
            .show();
    }
}

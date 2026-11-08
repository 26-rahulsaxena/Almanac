package app.almanac.calendar;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// A notification button (Snooze, Done, ...): closes the notification and tells the server, without opening the app.
// "Open" also opens the app.
public class ActionReceiver extends BroadcastReceiver {
    static PendingIntent intent(Context c, int nid, String id, String kind, String action) {
        Intent i = new Intent(c, ActionReceiver.class)
            .setAction(action + ":" + nid) // unique per button, so Android keeps each one's extras
            .putExtra("nid", nid).putExtra("id", id).putExtra("kind", kind).putExtra("action", action);
        return PendingIntent.getBroadcast(c, (action + nid).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context c, Intent i) {
        c.getSystemService(NotificationManager.class).cancel(i.getIntExtra("nid", 0));
        String action = i.getStringExtra("action");
        if ("open".equals(action)) {
            Intent app = new Intent(c, MainActivity.class).putExtra(MainActivity.PATH, "/?priorities=1").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(app);
        }
        PendingResult done = goAsync();
        new Thread(() -> {
            Notify.answer(c, i.getStringExtra("id"), i.getStringExtra("kind"), action);
            done.finish();
        }).start();
    }
}

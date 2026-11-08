package app.almanac.calendar;

import android.app.Activity;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

// The full-screen alarm when an event starts, shown over the lock screen. The sound comes from the notification
// (it repeats until the notification is closed), so answering here closes the notification too.
public class AlarmActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        int nid = getIntent().getIntExtra("nid", 0);
        String id = getIntent().getStringExtra("id");

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.parseColor("#111111"));
        int pad = dp(32);
        box.setPadding(pad, pad, pad, pad);

        box.addView(text("Starting now", 16, "#BBBBBB"));
        box.addView(text(getIntent().getStringExtra("title"), 34, "#FFFFFF"));
        String body = getIntent().getStringExtra("body");
        if (body != null && !body.isEmpty()) box.addView(text(body, 18, "#DDDDDD"));

        Button done = button("Done", "#FFFFFF", "#111111");
        Button snooze = button("Snooze " + getIntent().getIntExtra("snooze", 5) + " min", "#333333", "#FFFFFF");
        done.setOnClickListener(v -> answer(nid, id, "done"));
        snooze.setOnClickListener(v -> answer(nid, id, "snooze"));
        box.addView(done);
        box.addView(snooze);
        setContentView(box);
    }

    private void answer(int nid, String id, String action) {
        getSystemService(NotificationManager.class).cancel(nid);
        new Thread(() -> Notify.answer(getApplicationContext(), id, "reminder", action)).start();
        if (Build.VERSION.SDK_INT >= 26) getSystemService(KeyguardManager.class).requestDismissKeyguard(this, null);
        finish();
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private TextView text(String s, int sp, String color) {
        TextView t = new TextView(this);
        t.setText(s == null ? "" : s);
        t.setTextSize(sp);
        t.setTextColor(Color.parseColor(color));
        t.setGravity(Gravity.CENTER);
        t.setPadding(0, dp(8), 0, dp(8));
        return t;
    }

    private Button button(String label, String bg, String fg) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(18);
        b.setTextColor(Color.parseColor(fg));
        b.setBackgroundColor(Color.parseColor(bg));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56));
        lp.topMargin = dp(16);
        b.setLayoutParams(lp);
        return b;
    }
}

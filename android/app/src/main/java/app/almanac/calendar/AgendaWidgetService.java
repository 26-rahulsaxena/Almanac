package app.almanac.calendar;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// The rows of the Agenda widget: a heading for each day, then that day's events. Saved events look like
// {"title": "Dentist", "start": <ms>, "end": <ms>, "allDay": false, "color": "#c93a17"}, oldest first.
public class AgendaWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Rows(getApplicationContext());
    }

    private static final class Row {
        final String day; // set for a day heading
        final String title, time;
        final int color;

        Row(String day, String title, String time, int color) {
            this.day = day;
            this.title = title;
            this.time = time;
            this.color = color;
        }
    }

    private static final class Rows implements RemoteViewsFactory {
        private final Context c;
        private final List<Row> rows = new ArrayList<>();

        Rows(Context c) {
            this.c = c;
        }

        @Override
        public void onDataSetChanged() {
            rows.clear();
            JSONArray events;
            try {
                events = new JSONArray(c.getSharedPreferences("almanac", Context.MODE_PRIVATE).getString(AgendaWidget.KEY, "[]"));
            } catch (JSONException e) {
                return;
            }
            long now = System.currentTimeMillis();
            long today = midnight(now);
            DateFormat clock = android.text.format.DateFormat.getTimeFormat(c); // 12 or 24 hours, as the phone is set
            String lastDay = null;
            for (int i = 0; i < events.length(); i++) {
                JSONObject e = events.optJSONObject(i);
                if (e == null) continue;
                long start = e.optLong("start"), end = e.optLong("end");
                if (end <= now) continue;
                // Something that began before today (and is still on) is listed under today.
                String day = dayName(Math.max(midnight(start), today), today);
                if (!day.equals(lastDay)) {
                    rows.add(new Row(day, null, null, 0));
                    lastDay = day;
                }
                String time = e.optBoolean("allDay") ? "All day" : clock.format(new Date(start)) + " – " + clock.format(new Date(end));
                rows.add(new Row(null, e.optString("title", "(No title)"), time, color(e.optString("color"))));
            }
        }

        private static long midnight(long ms) {
            Calendar cal = Calendar.getInstance();
            cal.setTimeInMillis(ms);
            cal.set(Calendar.HOUR_OF_DAY, 0);
            cal.set(Calendar.MINUTE, 0);
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            return cal.getTimeInMillis();
        }

        private static String dayName(long day, long today) {
            Calendar tomorrow = Calendar.getInstance();
            tomorrow.setTimeInMillis(today);
            tomorrow.add(Calendar.DAY_OF_MONTH, 1);
            if (day == today) return "Today";
            if (day == tomorrow.getTimeInMillis()) return "Tomorrow";
            return new SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(new Date(day));
        }

        private static int color(String hex) {
            try {
                return Color.parseColor(hex);
            } catch (IllegalArgumentException e) {
                return Color.GRAY;
            }
        }

        @Override
        public RemoteViews getViewAt(int position) {
            Row r = rows.get(position);
            if (r.day != null) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_day);
                v.setTextViewText(R.id.widget_day, r.day);
                return v;
            }
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_event);
            v.setTextViewText(R.id.widget_title, r.title);
            v.setTextViewText(R.id.widget_time, r.time);
            v.setInt(R.id.widget_bar, "setBackgroundColor", r.color);
            v.setOnClickFillInIntent(R.id.widget_row, new Intent()); // opens Almanac
            return v;
        }

        @Override
        public int getCount() {
            return rows.size();
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

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public void onCreate() {}

        @Override
        public void onDestroy() {}
    }
}

package app.almanac.calendar;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

// The "Agenda" home-screen widget: the next two weeks, grouped by day. Almanac saves the events on this phone
// whenever it loads (AlmanacPlugin.setAgenda); the widget only reads that copy, so it works offline and never
// signs in itself. Every 30 minutes it redraws, dropping what has ended.
public class AgendaWidget extends AppWidgetProvider {
    static final String KEY = "agenda";

    static void save(Context c, String json) {
        c.getSharedPreferences("almanac", Context.MODE_PRIVATE).edit().putString(KEY, json).apply();
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, AgendaWidget.class));
        if (ids.length > 0) draw(c, m, ids);
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        draw(c, m, ids);
    }

    static void draw(Context c, AppWidgetManager m, int[] ids) {
        int immutable = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        // A list row's tap is filled into this one, so Android needs it mutable (12+).
        int mutable = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent open = PendingIntent.getActivity(c, 0, new Intent(c, MainActivity.class), immutable);
        PendingIntent row = PendingIntent.getActivity(c, 1, new Intent(c, MainActivity.class), mutable);
        String today = new SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(new Date());
        for (int id : ids) {
            Intent list = new Intent(c, AgendaWidgetService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
            list.setData(Uri.parse(list.toUri(Intent.URI_INTENT_SCHEME))); // one list per widget
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_agenda);
            v.setTextViewText(R.id.widget_date, today);
            v.setRemoteAdapter(R.id.widget_list, list);
            v.setEmptyView(R.id.widget_list, R.id.widget_empty);
            v.setOnClickPendingIntent(R.id.widget_header, open);
            v.setOnClickPendingIntent(R.id.widget_empty, open);
            v.setPendingIntentTemplate(R.id.widget_list, row);
            m.updateAppWidget(id, v);
        }
        m.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }
}

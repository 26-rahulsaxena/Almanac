package app.almanac.calendar;

import android.Manifest;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.messaging.FirebaseMessaging;

// What the website (src/lib/android-app.ts) can ask the app: switch on reminders and get this phone's Firebase
// token, check what's allowed, and open the phone's settings for full-screen alarms.
@CapacitorPlugin(name = "Almanac", permissions = @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }))
public class AlmanacPlugin extends Plugin {
    private boolean notificationsOn() {
        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
    }

    private boolean fullScreenOn() {
        return Build.VERSION.SDK_INT < 34 || getContext().getSystemService(NotificationManager.class).canUseFullScreenIntent();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("notifications", notificationsOn());
        r.put("fullScreen", fullScreenOn());
        call.resolve(r);
    }

    // Asks for permission if needed (Android 13+), then returns the token. Already refused twice: Android won't
    // ask again, so the app's notification settings open instead.
    @PluginMethod
    public void enable(PluginCall call) {
        Notify.channels(getContext());
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterPermission");
            return;
        }
        sendToken(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            getActivity().startActivity(i);
            JSObject r = new JSObject();
            r.put("notifications", false);
            call.resolve(r);
            return;
        }
        sendToken(call);
    }

    private void sendToken(PluginCall call) {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                call.reject("Couldn't reach Firebase");
                return;
            }
            JSObject r = new JSObject();
            r.put("notifications", notificationsOn());
            r.put("token", task.getResult());
            call.resolve(r);
        });
    }

    // This phone's token without asking anything (signing out removes it from the account).
    @PluginMethod
    public void token(PluginCall call) {
        sendToken(call);
    }

    // Speak instead of typing. Web speech-to-text doesn't work inside an app, so this opens Android's own voice
    // typing ("Speak now"), which handles the microphone itself, and returns the words heard ("" if nothing).
    @PluginMethod
    public void listen(PluginCall call) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Say what and when");
        try {
            startActivityForResult(call, i, "heard");
        } catch (ActivityNotFoundException e) {
            call.reject("This phone has no voice typing. Install or update the Google app, or type instead.");
        }
    }

    @ActivityCallback
    private void heard(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ArrayList<String> words = result.getData() == null ? null : result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        JSObject r = new JSObject();
        r.put("text", words == null || words.isEmpty() ? "" : words.get(0));
        call.resolve(r);
    }

    // The next two weeks for the home-screen Agenda widget (a JSON list, see AgendaWidgetService), kept on this
    // phone only. "[]" clears it, e.g. on signing out.
    @PluginMethod
    public void setAgenda(PluginCall call) {
        AgendaWidget.save(getContext(), call.getString("items", "[]"));
        call.resolve();
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        Intent i = Build.VERSION.SDK_INT >= 34
            ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName()))
            : new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        getActivity().startActivity(i);
        call.resolve();
    }
}

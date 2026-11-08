package app.almanac.calendar;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import org.json.JSONObject;

// Firebase hands every reminder here, even when the app is closed.
public class MessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage m) {
        String json = m.getData().get("json");
        if (json == null) return;
        try {
            Notify.show(this, new JSONObject(json));
        } catch (Exception e) {
            // A message this version doesn't understand: skip it.
        }
    }

    @Override
    public void onNewToken(String token) {
        // The app sends its current token to the server each time it opens (syncPush in the website).
    }
}

package app.almanac.calendar;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // A page of the site to open, from a tapped notification ("/?priorities=1").
    static final String PATH = "almanacPath";

    @Override
    public void onCreate(Bundle state) {
        registerPlugin(AlmanacPlugin.class);
        super.onCreate(state);
        go(getIntent());
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
}

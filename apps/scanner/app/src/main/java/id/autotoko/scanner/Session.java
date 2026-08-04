package id.autotoko.scanner;

import android.content.Context;
import android.content.SharedPreferences;

/** Base URL, bearer token and the device label, kept across launches. */
public final class Session {
    private static final String PREFS = "autotoko_scanner";
    private static final String K_BASE = "base_url";
    private static final String K_TOKEN = "token";
    private static final String K_EMAIL = "email";
    private static final String K_DEVICE = "device";

    public static final String DEFAULT_BASE = "https://viewtoko.cosger.online";

    private final SharedPreferences p;

    public Session(Context ctx) {
        p = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public String baseUrl() { return p.getString(K_BASE, DEFAULT_BASE); }
    public String token() { return p.getString(K_TOKEN, null); }
    public String email() { return p.getString(K_EMAIL, ""); }

    /** Free-text so a warehouse can tell "Meja 1" from "Meja 2" in the history. */
    public String device() { return p.getString(K_DEVICE, android.os.Build.MODEL); }

    public void save(String baseUrl, String token, String email) {
        p.edit().putString(K_BASE, baseUrl).putString(K_TOKEN, token).putString(K_EMAIL, email).apply();
    }

    public void setDevice(String label) { p.edit().putString(K_DEVICE, label).apply(); }

    public void clear() { p.edit().remove(K_TOKEN).apply(); }

    public boolean loggedIn() { return token() != null && !token().isEmpty(); }
}

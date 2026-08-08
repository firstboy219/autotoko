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
    private static final String K_REMIND = "remind_stock";
    private static final String K_REMIND_HOUR = "remind_stock_hour";

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

    /**
     * On by default.
     *
     * The whole point is the people who would not have gone looking for a
     * setting to switch it on — somebody who does not want it will meet it
     * once and turn it off, which is a cheaper mistake than never reminding
     * the person who needed it.
     */
    public boolean reminderEnabled() { return p.getBoolean(K_REMIND, true); }

    public void setReminderEnabled(boolean on) { p.edit().putBoolean(K_REMIND, on).apply(); }

    public int reminderHour() {
        return p.getInt(K_REMIND_HOUR, StockReminder.DEFAULT_HOUR);
    }

    public void setReminderHour(int hour) {
        p.edit().putInt(K_REMIND_HOUR, Math.max(0, Math.min(23, hour))).apply();
    }

    public void clear() { p.edit().remove(K_TOKEN).apply(); }

    public boolean loggedIn() { return token() != null && !token().isEmpty(); }
}

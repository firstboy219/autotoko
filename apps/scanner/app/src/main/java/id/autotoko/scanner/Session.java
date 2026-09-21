package id.autotoko.scanner;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/** Base URL, bearer token and the device label, kept across launches. */
public final class Session {
    private static final String PREFS = "autotoko_scanner";
    private static final String K_BASE = "base_url";
    private static final String K_TOKEN = "token";
    private static final String K_EMAIL = "email";
    private static final String K_DEVICE = "device";
    private static final String K_REMIND = "remind_stock";
    private static final String K_REMIND_HOUR = "remind_stock_hour";
    private static final String K_ACCOUNTS = "accounts";
    private static final String K_LOGIN_AT = "login_at";

    public static final String DEFAULT_BASE = "https://viewtoko.cosger.online";

    private final SharedPreferences p;

    public Session(Context ctx) {
        p = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public String baseUrl() { return p.getString(K_BASE, DEFAULT_BASE); }
    public String token() { return p.getString(K_TOKEN, null); }
    public String email() { return p.getString(K_EMAIL, ""); }

    /** Kapan sesi ini mulai (epoch ms). Lazy-init untuk sesi lama. */
    public long loginAt() {
        long t = p.getLong(K_LOGIN_AT, 0L);
        if (t == 0L) { t = System.currentTimeMillis(); p.edit().putLong(K_LOGIN_AT, t).apply(); }
        return t;
    }

    /** Free-text so a warehouse can tell "Meja 1" from "Meja 2" in the history. */
    public String device() { return p.getString(K_DEVICE, android.os.Build.MODEL); }

    public void save(String baseUrl, String token, String email) {
        p.edit().putString(K_BASE, baseUrl).putString(K_TOKEN, token).putString(K_EMAIL, email).putLong(K_LOGIN_AT, System.currentTimeMillis()).apply();
        upsertAccount(baseUrl, token, email);
    }

    /** Daftar akun tersimpan untuk switch akun: array JSON {email, base, token}. */
    public JSONArray accountsRaw() {
        try { return new JSONArray(p.getString(K_ACCOUNTS, "[]")); } catch (Exception e) { return new JSONArray(); }
    }
    private void upsertAccount(String base, String token, String email) {
        if (email == null || email.isEmpty()) return;
        try {
            JSONArray a = accountsRaw();
            JSONArray out = new JSONArray();
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && !email.equalsIgnoreCase(o.optString("email"))) out.put(o);
            }
            JSONObject me = new JSONObject();
            me.put("email", email); me.put("base", base); me.put("token", token);
            out.put(me);
            p.edit().putString(K_ACCOUNTS, out.toString()).apply();
        } catch (Exception ignored) {}
    }
    /** Jadikan akun tersimpan (email) sebagai aktif. */
    public boolean switchTo(String email) {
        if (email == null) return false;
        JSONArray a = accountsRaw();
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && email.equalsIgnoreCase(o.optString("email"))) {
                p.edit().putString(K_BASE, o.optString("base", DEFAULT_BASE))
                        .putString(K_TOKEN, o.optString("token", ""))
                        .putString(K_EMAIL, o.optString("email", email)).apply();
                return true;
            }
        }
        return false;
    }
    public void removeAccount(String email) {
        if (email == null) return;
        try {
            JSONArray a = accountsRaw();
            JSONArray out = new JSONArray();
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o != null && !email.equalsIgnoreCase(o.optString("email"))) out.put(o);
            }
            p.edit().putString(K_ACCOUNTS, out.toString()).apply();
        } catch (Exception ignored) {}
    }
    /** Logout akun aktif: lupakan akun ini dari daftar + hapus token aktif. */
    public void logout() {
        removeAccount(email());
        p.edit().remove(K_TOKEN).apply();
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

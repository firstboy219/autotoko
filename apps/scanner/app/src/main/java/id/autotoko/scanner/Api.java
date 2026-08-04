package id.autotoko.scanner;

import android.os.Handler;
import android.os.Looper;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.json.JSONObject;

/**
 * Small hand-rolled HTTP client. No OkHttp/Retrofit on purpose: this app makes
 * four kinds of call, and a warehouse APK is easier to trust and to keep
 * building over the years with fewer third-party moving parts.
 *
 * Every response body is parsed and handed back whatever the status was —
 * the duplicate case is a 409 whose BODY is the useful part, so treating
 * non-2xx as an opaque failure would throw away the answer we came for.
 */
public final class Api {

    public interface Cb { void done(Resp r); }

    public static final class Resp {
        public final int code;
        public final JSONObject body;   // may be null on a transport error
        public final String transportError;

        Resp(int code, JSONObject body, String transportError) {
            this.code = code;
            this.body = body;
            this.transportError = transportError;
        }

        public boolean ok() { return code >= 200 && code < 300; }

        public JSONObject data() {
            return body == null ? null : body.optJSONObject("data");
        }

        /** Best human-readable line we can offer, whatever shape the error took. */
        public String message(String fallback) {
            if (transportError != null) return transportError;
            if (body == null) return fallback;
            Object m = body.opt("message");
            if (m instanceof org.json.JSONArray) {
                org.json.JSONArray a = (org.json.JSONArray) m;
                return a.length() > 0 ? a.optString(0) : fallback;
            }
            String s = body.optString("message", "");
            return s.isEmpty() ? fallback : s;
        }
    }

    private static final ExecutorService POOL = Executors.newFixedThreadPool(2);
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final int TIMEOUT_MS = 20000;

    private final Session session;

    public Api(Session session) { this.session = session; }

    public void login(String baseUrl, String email, String password, Cb cb) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("email", email);
            payload.put("password", password);
        } catch (Exception ignored) {}
        call("POST", baseUrl + "/api/auth/password/login", null, payload, cb);
    }

    /**
     * photoBase64 may be null: a scan whose photo failed to encode is still a
     * scan, and losing the parcel would be far worse than losing the picture.
     */
    public void scan(String resi, String raw, String source, String barcodeFormat,
                     String photoBase64, Cb cb) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("resi", resi);
            payload.put("resiRaw", raw);
            payload.put("source", source);
            payload.put("deviceLabel", session.device());
            if (barcodeFormat != null) payload.put("barcodeFormat", barcodeFormat);
            if (photoBase64 != null) payload.put("photoBase64", photoBase64);
        } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/resi/scan", session.token(), payload, cb);
    }

    public void history(Cb cb) {
        call("GET", session.baseUrl() + "/api/resi/scans?limit=100", session.token(), null, cb);
    }

    public void summary(Cb cb) {
        call("GET", session.baseUrl() + "/api/resi/scans/summary", session.token(), null, cb);
    }

    public void delete(String id, Cb cb) {
        call("DELETE", session.baseUrl() + "/api/resi/scans/" + id, session.token(), null, cb);
    }

    private void call(String method, String url, String token, JSONObject payload, Cb cb) {
        POOL.execute(() -> {
            Resp r = blocking(method, url, token, payload);
            MAIN.post(() -> cb.done(r));
        });
    }

    private Resp blocking(String method, String url, String token, JSONObject payload) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod(method);
            c.setConnectTimeout(TIMEOUT_MS);
            c.setReadTimeout(TIMEOUT_MS);
            c.setRequestProperty("Accept", "application/json");
            if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);

            if (payload != null) {
                // Only set the content type when there IS a body: Fastify
                // rejects an empty body sent as application/json outright.
                c.setRequestProperty("Content-Type", "application/json");
                c.setDoOutput(true);
                byte[] out = payload.toString().getBytes(StandardCharsets.UTF_8);
                OutputStream os = c.getOutputStream();
                os.write(out);
                os.close();
            }

            int code = c.getResponseCode();
            InputStream is = (code >= 200 && code < 300) ? c.getInputStream() : c.getErrorStream();
            String text = read(is);
            JSONObject body = null;
            if (text != null && text.startsWith("{")) {
                try { body = new JSONObject(text); } catch (Exception ignored) {}
            }
            return new Resp(code, body, null);
        } catch (Exception e) {
            String m = e.getMessage();
            return new Resp(0, null, "Tidak bisa menghubungi server" + (m == null ? "" : " (" + m + ")"));
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String read(InputStream is) {
        if (is == null) return null;
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
        } catch (Exception ignored) {}
        return sb.toString();
    }
}

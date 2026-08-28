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

import org.json.JSONArray;
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

    /**
     * Told when a request comes back unauthorised.
     *
     * The token lasts twelve hours and nothing renews it, so every screen has
     * to cope with it expiring mid-shift. Handling it in one place means a
     * packer sees "sesi berakhir, masuk lagi" wherever they are, instead of a
     * raw error on one screen and a silent empty list on another.
     */
    public interface OnUnauthorised { void expired(); }

    private static volatile OnUnauthorised unauthorisedHandler = null;

    public static void onUnauthorised(OnUnauthorised h) { unauthorisedHandler = h; }

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

        /**
         * The same envelope when the payload is a list rather than an object.
         *
         * Some endpoints return `data: [...]` and data() quietly gives null
         * for those, which reads at the call site as a failed request.
         */
        public org.json.JSONArray dataArray() {
            return body == null ? null : body.optJSONArray("data");
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
    /**
     * The seller's own products, so the scanner can name what it reads.
     *
     * Matching against a closed list is what makes reading a marketing title
     * off a label workable at all: the phone does not have to spell
     * "Mouthspray Siwak 100ml" correctly, it only has to pick it out of
     * twenty-five.
     */
    public void products(Cb cb) {
        call("GET", session.baseUrl() + "/api/products", session.token(), null, cb);
    }

    public void scan(String resi, String raw, String source, String barcodeFormat,
                     String photoBase64, JSONObject reading, Cb cb) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("resi", resi);
            payload.put("resiRaw", raw);
            payload.put("source", source);
            payload.put("deviceLabel", session.device());
            if (barcodeFormat != null) payload.put("barcodeFormat", barcodeFormat);
            if (photoBase64 != null) payload.put("photoBase64", photoBase64);
            // What the phone made of the label, sent alongside the photo rather
            // than instead of it. The server still reads the picture; where the
            // two disagree, the phone had dozens of frames and the server has
            // one JPEG.
            if (reading != null) {
                java.util.Iterator<String> keys = reading.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    payload.put(k, reading.get(k));
                }
            }
        } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/resi/scan", session.token(), payload, cb);
    }

    /**
     * Create a master product from text read off a package.
     *
     * SKU is required by the API and nobody standing at a shelf has one in
     * mind, so the caller generates a readable one from the name — see
     * TextScanActivity.suggestSku.
     */
    public void createProduct(String name, String sku, String price, Cb cb) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("sku", sku);
            payload.put("name", name);
            payload.put("status", "active");
            if (price != null && !price.isEmpty()) payload.put("basePrice", price);
        } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/products", session.token(), payload, cb);
    }

    /** Replace a product's alias block. The caller appends; this only stores. */
    public void setProductAliases(String productId, String aliases, Cb cb) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("marketplaceAliases", aliases);
        } catch (Exception ignored) {}
        call("PATCH", session.baseUrl() + "/api/products/" + productId,
                session.token(), payload, cb);
    }

    /**
     * Report a parcel of raw materials that arrived.
     *
     * codAmount is passed as a negative when there is no COD, rather than as
     * zero: zero is a real amount a courier could be owed, and the two must not
     * collapse into each other on the way to the server.
     */
    public void recordDelivery(String resi, String photoBase64, String deviceText,
                               org.json.JSONArray items, boolean isCod, double codAmount,
                               double totalCost, String orderPhotoUrl, Cb cb) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("resi", resi);
            if (photoBase64 != null) payload.put("photoBase64", photoBase64);
            if (deviceText != null && !deviceText.isEmpty()) {
                payload.put("deviceText",
                        deviceText.length() > 20000 ? deviceText.substring(0, 20000) : deviceText);
            }
            payload.put("items", items);
            payload.put("isCod", isCod);
            if (isCod && codAmount >= 0) payload.put("codAmount", codAmount);
            // Sent whether or not it was COD. A transfer-paid parcel used to
            // arrive priceless, and its materials carried no cost into the HPP.
            if (totalCost > 0) payload.put("totalCost", totalCost);
            if (orderPhotoUrl != null && !orderPhotoUrl.isEmpty()) {
                payload.put("orderPhotoUrl", orderPhotoUrl);
            }
        } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/materials/deliveries", session.token(), payload, cb);
    }

    /** Create a raw material, or get back the one already named that. */
    public void createMaterial(String name, String unit, String unitCost, Cb cb) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("name", name);
            if (unit != null && !unit.isEmpty()) payload.put("unit", unit);
            if (unitCost != null && !unitCost.isEmpty()) {
                payload.put("unitCost", Double.parseDouble(unitCost));
            }
        } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/materials", session.token(), payload, cb);
    }

    /** The seller's raw materials, for the stock screen. */
    public void materials(Cb cb) {
        call("GET", session.baseUrl() + "/api/materials", session.token(), null, cb);
    }

    /** One material's shelf reading: habis / hampir_habis / cukup / normal / banyak. */
    public void setStockLevel(String materialId, String level, Cb cb) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("stockLevel", level);
        } catch (Exception ignored) {}
        call("PATCH", session.baseUrl() + "/api/materials/" + materialId,
                session.token(), payload, cb);
    }

    /**
     * Another sheet of a waybill already scanned.
     *
     * Carries the photo that was just rejected as a duplicate rather than
     * taking a new one — the packer has already aimed at the sheet, and asking
     * them to do it twice for the same picture is how a feature goes unused.
     */
    public void addPage(String scanId, String photoBase64, String deviceText, Cb cb) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("photoBase64", photoBase64);
            if (deviceText != null && !deviceText.isEmpty()) payload.put("deviceText", deviceText);
        } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/resi/scans/" + scanId + "/pages",
                session.token(), payload, cb);
    }

    /**
     * Record that a person checked what was in the parcel.
     *
     * Separate from the scan itself: the scan says a waybill was photographed,
     * this says somebody read the contents and stands behind them. Refused by
     * the server while any line has no product, so a half-filled sheet cannot
     * be passed off as checked.
     */
    public void confirmItems(String scanId, Cb cb) {
        JSONObject body = new JSONObject();
        try { body.put("by", android.os.Build.MODEL); } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/resi/scans/" + scanId + "/items/confirm",
                session.token(), body, cb);
    }

    /**
     * Create a master product from the bench.
     *
     * The label names something that is not in the catalogue, and the packer
     * is standing there holding it. The alternative was to leave the line
     * unmapped and hope somebody reconstructed it later from a photograph.
     */
    public void createProduct(String name, String sku, Cb cb) {
        JSONObject body = new JSONObject();
        try {
            body.put("name", name);
            body.put("sku", sku);
        } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/products", session.token(), body, cb);
    }

    /**
     * What is not finished, same list the web shows.
     *
     * One endpoint for both so the two screens cannot disagree about how much
     * is outstanding — two numbers for one question is worse than one number.
     */
    public void pendingTasks(Cb cb) {
        call("GET", session.baseUrl() + "/api/dashboard/pending-tasks", session.token(), null, cb);
    }

    /**
     * Send an order screenshot; get it stored and read back.
     *
     * One call rather than upload-then-parse: the packer is holding a box, and
     * the screenshot is stored even when the reading fails, so a parse nobody
     * agrees with still leaves the evidence behind.
     */
    public void scanOrderPhoto(String photoBase64, Cb cb) {
        JSONObject body = new JSONObject();
        try { body.put("photoBase64", photoBase64); } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/materials/purchases/scan-order",
                session.token(), body, cb);
    }

    /**
     * Angka dashboard, dari endpoint yang sama dengan web.
     *
     * Satu panggilan membawa seluruhnya -- ringkasan, bacaan statistik,
     * penilaian toko, produk, dan belanja stok -- jadi layarnya tidak perlu
     * merangkai beberapa permintaan di jaringan yang mungkin lambat.
     */
    public void shopInsights(String from, String to, Cb cb) {
        String q = "?from=" + from + "&to=" + to;
        call("GET", session.baseUrl() + "/api/dashboard/shop-insights" + q,
                session.token(), null, cb);
    }

    /* ------------------------------------------------ pencairan dana */

    /**
     * Alur pencairan yang sama persis dengan web, lewat endpoint yang sama.
     *
     * Tidak ada endpoint baru dan tidak ada aturan yang dikendurkan: seluruh
     * penjagaan -- pencairan ganda, bukti yang dipakai dua kali, batas
     * transfer minimum, pencocokan OCR -- hidup di server dan berlaku sama
     * dari mana saja permintaannya datang. Yang dipindah ke sini cuma
     * layarnya.
     */
    public void payoutBatches(Cb cb) {
        call("GET", session.baseUrl() + "/api/payout/batches", session.token(), null, cb);
    }

    public void payoutBatch(String id, Cb cb) {
        call("GET", session.baseUrl() + "/api/payout/batches/" + id, session.token(), null, cb);
    }

    public void payoutNewBatch(Cb cb) {
        call("POST", session.baseUrl() + "/api/payout/batches", session.token(),
                new JSONObject(), cb);
    }

    /** Toko beserta tarif yang berlaku — dipakai untuk memilih saat merekam. */
    public void payoutShops(Cb cb) {
        call("GET", session.baseUrl() + "/api/payout/shops", session.token(), null, cb);
    }

    /**
     * Simpan bukti pencairan sebagai berkas, dapat url-nya.
     *
     * Terpisah dari perekamannya, sama seperti di web: gambarnya diunggah
     * dulu, url-nya yang ikut ke mutasi. Server menyidik jari isinya untuk
     * menolak bukti yang sudah pernah dipakai.
     */
    public void uploadImage(String base64, String ext, Cb cb) {
        JSONObject b = new JSONObject();
        try {
            b.put("base64", base64);
            b.put("ext", ext);
        } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/uploads", session.token(), b, cb);
    }

    public void payoutRecord(String batchId, String shopId, String payoutDate,
                             double amount, String proofUrl, Cb cb) {
        JSONObject b = new JSONObject();
        try {
            b.put("batchId", batchId);
            b.put("shopId", shopId);
            b.put("payoutDate", payoutDate);
            b.put("marketplaceProofAmount", amount);
            if (proofUrl != null && !proofUrl.isEmpty()) b.put("marketplaceProofUrl", proofUrl);
        } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/payout/mutations", session.token(), b, cb);
    }

    public void payoutDeleteMutation(String id, Cb cb) {
        call("DELETE", session.baseUrl() + "/api/payout/mutations/" + id, session.token(), null, cb);
    }

    public void payoutCloseInput(String id, Cb cb) {
        call("POST", session.baseUrl() + "/api/payout/batches/" + id + "/close-input",
                session.token(), new JSONObject(), cb);
    }

    public void payoutUploadProof(String disbursementId, String proofUrl, Cb cb) {
        JSONObject b = new JSONObject();
        try { b.put("proofUrl", proofUrl); } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/payout/disbursements/" + disbursementId + "/proof",
                session.token(), b, cb);
    }

    public void payoutOverride(String disbursementId, String reason, Cb cb) {
        JSONObject b = new JSONObject();
        try { b.put("reason", reason); } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/payout/disbursements/" + disbursementId + "/override",
                session.token(), b, cb);
    }

    public void payoutClose(String id, Cb cb) {
        call("POST", session.baseUrl() + "/api/payout/batches/" + id + "/close",
                session.token(), new JSONObject(), cb);
    }

    /**
     * Kembali dari tahap transfer ke tahap rekam.
     *
     * `force` adalah pemakainya menyatakan menerima kehilangan bukti yang
     * sudah diunggah -- servernya menolak tanpa itu, dan penolakannya menyebut
     * berapa bukti yang akan hilang. Layar bertanya dengan kalimat penuh
     * sebelum mengirim ulang dengan force.
     */
    public void payoutReopenInput(String id, boolean force, Cb cb) {
        JSONObject b = new JSONObject();
        try { b.put("force", force); } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/payout/batches/" + id + "/reopen-input",
                session.token(), b, cb);
    }

    /** Hitung ulang seluruh mutasi memakai tarif terbaru; hanya selagi terbuka. */
    public void payoutRecalculate(String id, Cb cb) {
        call("POST", session.baseUrl() + "/api/payout/batches/" + id + "/recalculate",
                session.token(), new JSONObject(), cb);
    }

    /** Bukti transfer fee admin sebuah batch. Satu batch satu bukti. */
    public void payoutFeeProof(String batchId, String proofUrl, Cb cb) {
        JSONObject b = new JSONObject();
        try { b.put("proofUrl", proofUrl); } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/payout/batches/" + batchId + "/admin-fee-proof",
                session.token(), b, cb);
    }

    public void payoutClearFeeProof(String batchId, Cb cb) {
        call("DELETE", session.baseUrl() + "/api/payout/batches/" + batchId + "/admin-fee-proof",
                session.token(), null, cb);
    }

    public void payoutDeleteBatch(String id, Cb cb) {
        call("DELETE", session.baseUrl() + "/api/payout/batches/" + id, session.token(), null, cb);
    }

    /** One recorded stock purchase, with its lines. */
    public void purchase(String id, Cb cb) {
        call("GET", session.baseUrl() + "/api/materials/purchases/" + id,
                session.token(), null, cb);
    }

    /**
     * Rewrite a purchase's lines.
     *
     * The server reverses everything the purchase put on the shelf and applies
     * the new set, so this has to carry EVERY line — sending only the changed
     * ones would delete the rest.
     */
    public void updatePurchase(String id, JSONArray items, Cb cb) {
        JSONObject body = new JSONObject();
        try { body.put("items", items); } catch (Exception ignored) {}
        call("PATCH", session.baseUrl() + "/api/materials/purchases/" + id,
                session.token(), body, cb);
    }

    /** What the parcel was recorded as containing. */
    public void scanItems(String scanId, Cb cb) {
        call("GET", session.baseUrl() + "/api/resi/scans/" + scanId + "/items",
                session.token(), null, cb);
    }

    /** Point one recorded line at a different product, or change its count. */
    public void updateScanItem(String scanId, String itemId, String masterProductId,
                               Double qty, Cb cb) {
        JSONObject body = new JSONObject();
        try {
            if (masterProductId != null) body.put("masterProductId", masterProductId);
            if (qty != null) body.put("qty", qty);
        } catch (Exception ignored) {}
        call("PATCH", session.baseUrl() + "/api/resi/scans/" + scanId + "/items/" + itemId,
                session.token(), body, cb);
    }

    /** Remove a line the reader invented, or one that was never in the box. */
    public void deleteScanItem(String scanId, String itemId, Cb cb) {
        call("DELETE", session.baseUrl() + "/api/resi/scans/" + scanId + "/items/" + itemId,
                session.token(), null, cb);
    }

    /**
     * Corrections this tenant has already made, for matching offline.
     *
     * Fetched once at launch with the catalogue. A tenant's vocabulary is
     * small — it is their own labels, repeatedly — and asking per scan would
     * put a round trip in front of the sheet the packer is waiting on.
     */
    /**
     * One day's packing: totals, a count per courier, and what is incomplete.
     *
     * The last part is why this is a request rather than a tally the phone
     * keeps: a shift is packed on several handsets and the question is about
     * the day, not about this one.
     */
    public void dailyRecap(Cb cb) {
        call("GET", session.baseUrl() + "/api/resi/daily-recap", session.token(), null, cb);
    }

    public void ocrHints(Cb cb) {
        call("GET", session.baseUrl() + "/api/resi/ocr-hints", session.token(), null, cb);
    }

    /** The seller's shops and the courier list, for the mapping sheet. */
    public void mappingOptions(Cb cb) {
        call("GET", session.baseUrl() + "/api/resi/mapping-options", session.token(), null, cb);
    }

    /** Change where an already-saved scan came from, from the history screen. */
    public void confirmMapping(String scanId, String shopId, String marketplace,
                               String courier, Cb cb) {
        JSONObject body = new JSONObject();
        try {
            if (shopId != null) body.put("shopId", shopId);
            if (marketplace != null) body.put("marketplace", marketplace);
            body.put("courier", courier);
            body.put("by", android.os.Build.MODEL);
        } catch (Exception ignored) {}
        call("POST", session.baseUrl() + "/api/resi/scans/" + scanId + "/mapping",
                session.token(), body, cb);
    }

    /**
     * Has today's stock round been done? Asked by the daily reminder.
     *
     * The answer has to come from the server: several people share the shelf,
     * and a phone only knows what its own owner did.
     */
    public void stockFreshness(Cb cb) {
        call("GET", session.baseUrl() + "/api/materials/stock-freshness",
                session.token(), null, cb);
    }

    /** Raw-material parcels reported from this phone, newest first. */
    public void purchases(Cb cb) {
        call("GET", session.baseUrl() + "/api/materials/purchases", session.token(), null, cb);
    }

    /**
     * Delete a reported parcel and give back what it added to the shelf.
     *
     * The server reverses the stock; this is not a hide. A parcel scanned
     * twice or scanned by mistake otherwise had to be corrected by somebody
     * editing the stock figure by hand to a number they worked out themselves.
     */
    public void deletePurchase(String id, Cb cb) {
        call("DELETE", session.baseUrl() + "/api/materials/purchases/" + id,
                session.token(), null, cb);
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
            MAIN.post(() -> {
                // Every screen, not just the one that happened to check. The
                // token lasts twelve hours and nothing renews it, so this
                // fires mid-shift and used to surface as a raw error here and
                // an empty list there.
                if (r.code == 401 && unauthorisedHandler != null) {
                    unauthorisedHandler.expired();
                }
                cb.done(r);
            });
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

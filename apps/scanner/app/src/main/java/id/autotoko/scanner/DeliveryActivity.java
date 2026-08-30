package id.autotoko.scanner;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.content.Intent;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "Bahan baku datang": the mirror image of scanning a parcel out.
 *
 * The same three steps the packing scan already uses — read the waybill from
 * its barcode, photograph it, map what is inside against master data — pointed
 * the other way: this adds to stock instead of shipping it out.
 *
 * The mapping asks for two numbers rather than one, and that is the part worth
 * getting right. A delivery is counted in packages ("3 bottles") while the
 * catalogue holds whatever a recipe consumes ("ml"). Asking only for the
 * package count would add three millilitres of glycerine to a shelf that just
 * received three hundred.
 */
public class DeliveryActivity extends AppCompatActivity {

    private static final int REQ_CAMERA = 103;
    private static final android.util.Size ANALYSIS_SIZE = new android.util.Size(1920, 1080);
    /**
     * Disamakan dengan resi packing (2560/85).
     *
     * Nota bahan baku adalah jejak audit untuk uang yang KELUAR, dan ia justru
     * yang paling rendah resolusinya di seluruh sistem. Pada 1600 piksel,
     * angka nominal yang ditulis tangan di sudut nota sudah tidak terbaca lagi
     * begitu gambarnya diperbesar -- padahal itulah yang perlu diperiksa.
     */
    private static final int PHOTO_MAX_EDGE = 2560;
    /** Let autofocus settle before the shutter; see focusThenCapture. */
    /** Picking an image leaves the activity; the sheet's parts wait here. */
    private static final int REQ_ORDER_PHOTO = 7301;
    private List<Row> pendingRows = null;
    private EditText pendingAmountField = null;
    private MaterialButton pendingOrderButton = null;
    private TextView pendingOrderNote = null;
    /** Set once a screenshot is stored; travels with the delivery. */
    private String orderPhotoUrl = null;

    /**
     * Bidikan-bidikan nota yang akan disatukan jadi satu gambar.
     *
     * Satu foto seluruh nota dari jarak yang cukup untuk memuat semuanya
     * berarti tidak ada satu bagian pun yang beresolusi cukup untuk dibaca.
     * Beberapa bidikan dekat, lalu disatukan, memberi keduanya: pandangan
     * menyeluruh dan tiap bagian yang benar-benar terbaca.
     */
    private final List<String> bidikanNota = new ArrayList<>();

    /** Lebih dari ini, kanvas gabungannya mulai mengecilkan tiap bidikan. */
    private static final int MAKS_BIDIKAN = 4;

    /**
     * Setiap frame ikut memilih bahan mana yang ada di nota.
     *
     * Mekanisme yang sama dengan nomor pesanan di scan resi packing: satu frame
     * adalah tebakan, puluhan frame yang sepakat adalah bukti. Dipakai untuk
     * memutuskan KAPAN panduan boleh berhenti -- bukan untuk memilih bahannya,
     * yang tetap diambil dari teks terkumpul supaya nama yang terbelah antar
     * baris tetap utuh.
     */
    private final SuaraBahan suaraBahan = new SuaraBahan();
    private boolean panduanNotaAktif = false;
    private long panduanMulai = 0;
    private long bidikanTerakhirAt = 0;

    /** Jarak antar bidikan otomatis. */
    private static final long JEDA_BIDIK_MS = 2000;

    private static final long FOCUS_SETTLE_MS = 600;
    /** After this long with nothing decoded, stop looking confident about it. */
    private static final long NO_HIT_HINT_MS = 6000;
    private static final int PHOTO_QUALITY = 85;

    private PreviewView preview;
    private TextView status, hint, read;

    private Session session;
    private Api api;
    private BarcodeScanner barcodes;
    private TextRecognizer recognizer;
    private ImageCapture imageCapture;
    private ExecutorService cameraExecutor;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());

    private final TextCollector collector = new TextCollector();
    /** Materials as matchable entries; the unit rides along separately. */
    private final List<ProductMatcher.Product> catalogue = new ArrayList<>();
    private final Map<String, String> units = new HashMap<>();

    private volatile boolean busy = false;
    private volatile boolean analysing = false;
    private volatile boolean readingText = false;
    private androidx.camera.core.Camera camera;
    private long lookingSince = 0;
    private boolean torchOn = false;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        session = new Session(this);
        api = new Api(session);
        cameraExecutor = Executors.newSingleThreadExecutor();
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        // EVERY format, unlike the packing scan.
        //
        // That screen is restricted to CODE_128/39 for a good reason — Indonesian
        // courier waybills use CODE_128, and accepting retail symbologies once
        // recorded five parcels that did not exist. Copying the restriction here
        // was the mistake: a supplier's parcel is a different population. Plenty
        // arrive with a QR label, an ITF carton code or a plain EAN, and against
        // those the scanner simply never fired — which is exactly the "nothing
        // happens" that was reported.
        //
        // The risk that made the restriction worth it there does not apply here
        // either: a wrong read cannot invent a shipment, because the packer
        // still has to map the contents by hand, and the number is editable
        // before anything is saved.
        barcodes = BarcodeScanning.getClient(new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(
                        Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39, Barcode.FORMAT_CODE_93,
                        Barcode.FORMAT_CODABAR, Barcode.FORMAT_ITF, Barcode.FORMAT_EAN_13,
                        Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E,
                        Barcode.FORMAT_QR_CODE, Barcode.FORMAT_DATA_MATRIX, Barcode.FORMAT_PDF417,
                        Barcode.FORMAT_AZTEC)
                .build());

        setContentView(R.layout.activity_delivery);
        preview = findViewById(R.id.dlPreview);
        status = findViewById(R.id.dlStatus);
        hint = findViewById(R.id.dlHint);
        read = findViewById(R.id.dlRead);
        findViewById(R.id.dlClose).setOnClickListener(v -> finish());
        findViewById(R.id.dlTorch).setOnClickListener(v -> toggleTorch());
        findViewById(R.id.dlManual).setOnClickListener(v -> promptManual());

        loadMaterials();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        } else {
            startCamera();
        }
    }

    @Override public void onRequestPermissionsResult(
            int req, @NonNull String[] perms, @NonNull int[] granted) {
        super.onRequestPermissionsResult(req, perms, granted);
        if (req == REQ_CAMERA && granted.length > 0 && granted[0] == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            hint.setText("Izin kamera ditolak. Pakai Input Resi Manual.");
        }
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        if (cameraExecutor != null) cameraExecutor.shutdown();
    }

    private void loadMaterials() {
        api.materials(r -> {
            if (!r.ok() || r.body == null) return;
            JSONArray arr = r.body.optJSONArray("data");
            if (arr == null) return;
            catalogue.clear();
            units.clear();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String id = o.optString("id", "");
                if (id.isEmpty()) continue;
                String unit = o.optString("unit", "");
                if ("null".equals(unit)) unit = "";
                // The unit doubles as the matcher's "sku" field so a waybill
                // reading "Aquades 1L" can still favour the litre entry.
                catalogue.add(new ProductMatcher.Product(id, o.optString("name", ""), unit));
                units.put(id, unit);
            }
        });
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                ProcessCameraProvider provider = future.get();
                Preview p = new Preview.Builder().build();
                p.setSurfaceProvider(preview.getSurfaceProvider());

                ImageAnalysis analysis = new ImageAnalysis.Builder()
                        .setResolutionSelector(
                                new androidx.camera.core.resolutionselector.ResolutionSelector.Builder()
                                        .setResolutionStrategy(
                                                new androidx.camera.core.resolutionselector.ResolutionStrategy(
                                                        ANALYSIS_SIZE,
                                                        androidx.camera.core.resolutionselector.ResolutionStrategy
                                                                .FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                                        .build())
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build();
                analysis.setAnalyzer(cameraExecutor, this::analyse);

                imageCapture = new ImageCapture.Builder()
                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                        .build();

                provider.unbindAll();
                camera = provider.bindToLifecycle(
                        this, CameraSelector.DEFAULT_BACK_CAMERA, p, analysis, imageCapture);
                lookingSince = android.os.SystemClock.uptimeMillis();
            } catch (Exception e) {
                hint.setText("Kamera tidak bisa dibuka: " + e.getMessage());
            }
        }, ContextCompat.getMainExecutor(this));
    }

    @ExperimentalGetImage
    private void analyse(ImageProxy proxy) {
        if (analysing) {
            proxy.close();
            return;
        }
        android.media.Image media = proxy.getImage();
        if (media == null) {
            proxy.close();
            return;
        }
        int rot = proxy.getImageInfo().getRotationDegrees();

        // Text is gathered the whole time, including while the mapping sheet is
        // open — the names on the waybill are what the sheet is built from, and
        // one frame of them is a guess.
        if (!readingText) {
            readingText = true;
            recognizer.process(InputImage.fromMediaImage(media, rot))
                    .addOnSuccessListener(t -> {
                        final String teks = t.getText();
                        collector.addFrame(teks);
                        main.post(() -> {
                            catatBahanDariFrame(teks);
                            renderRead();
                        });
                    })
                    .addOnCompleteListener(t -> readingText = false);
        }

        if (busy) {
            proxy.close();
            return;
        }
        main.post(this::renderLooking);
        analysing = true;
        barcodes.process(InputImage.fromMediaImage(media, rot))
                .addOnSuccessListener(codes -> main.post(() -> onBarcodes(codes)))
                .addOnCompleteListener(t -> {
                    analysing = false;
                    proxy.close();
                });
    }

    /**
     * Proof that the camera is working while it finds nothing.
     *
     * A still screen reads as a broken one, and this screen could sit
     * unchanged for a minute against a label whose symbology it had been told
     * to ignore. After a few seconds it also points at the way out.
     */
    private void renderLooking() {
        if (busy || lookingSince == 0) return;
        long waited = android.os.SystemClock.uptimeMillis() - lookingSince;
        if (waited < NO_HIT_HINT_MS) {
            hint.setText("Mencari barcode pada resi…");
        } else {
            hint.setText("Barcode belum terbaca. Dekatkan kamera, nyalakan lampu, "
                    + "atau pakai Input Resi Manual.");
        }
    }

    private void renderRead() {
        List<String> lines = collector.lines();
        if (lines.isEmpty()) {
            read.setVisibility(View.GONE);
            return;
        }
        StringBuilder sb = new StringBuilder("Terbaca: ");
        for (int i = 0; i < Math.min(3, lines.size()); i++) {
            if (i > 0) sb.append(" · ");
            sb.append(lines.get(i));
        }
        read.setText(sb.toString());
        read.setVisibility(View.VISIBLE);
    }

    /**
     * Pick the code most likely to be the waybill.
     *
     * With every symbology accepted, a carton can present several at once — the
     * courier's own label, a retail EAN printed on the box, a QR pointing at a
     * catalogue page. CODE_128 and CODE_39 are what couriers actually print, so
     * they win outright; among equals the longest value is taken, a retail EAN
     * being both shorter and rarely the thing anyone means.
     */
    private void onBarcodes(List<Barcode> codes) {
        if (busy || codes == null || codes.isEmpty()) return;

        String best = null;
        int bestRank = -1;
        for (Barcode c : codes) {
            String raw = c.getRawValue();
            if (raw == null) continue;
            String resi = ResiExtractor.normalize(raw);
            if (resi.length() < 6 || resi.length() > 32) continue;
            int rank = (c.getFormat() == Barcode.FORMAT_CODE_128
                    || c.getFormat() == Barcode.FORMAT_CODE_39) ? 2 : 1;
            if (rank > bestRank || (rank == bestRank && best != null && resi.length() > best.length())) {
                best = resi;
                bestRank = rank;
            }
        }
        if (best == null) return;

        busy = true;
        feedback();
        status.setText(best);
        hint.setText("Memotret resi...");
        focusThenCapture(best);
    }

    /**
     * Say out loud that the code was read.
     *
     * The packing screen has done this from the start. Here there was nothing
     * at all — no sound, no buzz, and a photo that takes a moment — so a
     * successful scan and a scan that never fired looked identical.
     */
    private void feedback() {
        try {
            new android.media.ToneGenerator(android.media.AudioManager.STREAM_NOTIFICATION, 80)
                    .startTone(android.media.ToneGenerator.TONE_PROP_BEEP, 140);
        } catch (Exception ignored) {
        }
        try {
            android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (android.os.Build.VERSION.SDK_INT >= 26) {
                    v.vibrate(android.os.VibrationEffect.createOneShot(
                            60, android.os.VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(60);
                }
            }
        } catch (Exception ignored) {
        }
    }

    /**
     * Nudge autofocus before the shutter.
     *
     * The photo is the audit trail for a stock movement, and this screen was
     * taking it the instant the barcode decoded — at whatever focus the camera
     * happened to be at, which after a close-range barcode read is rarely the
     * whole label.
     */
    private void focusThenCapture(String resi) {
        try {
            if (camera != null) {
                androidx.camera.core.MeteringPoint point = preview.getMeteringPointFactory()
                        .createPoint(preview.getWidth() / 2f, preview.getHeight() / 2f);
                camera.getCameraControl().startFocusAndMetering(
                        new androidx.camera.core.FocusMeteringAction.Builder(
                                point, androidx.camera.core.FocusMeteringAction.FLAG_AF)
                                .disableAutoCancel()
                                .build());
            }
        } catch (Exception ignored) {
            // Focus is an improvement, not a requirement.
        }
        main.postDelayed(() -> capture(resi), FOCUS_SETTLE_MS);
    }

    private void capture(String resi) {
        if (imageCapture == null) {
            map(resi, null);
            return;
        }
        imageCapture.takePicture(cameraExecutor, new ImageCapture.OnImageCapturedCallback() {
            @Override public void onCaptureSuccess(@NonNull ImageProxy image) {
                String b64 = null;
                try {
                    b64 = toBase64Jpeg(image);
                } catch (Throwable ignored) {
                    // A photo is the audit trail, not the report. Losing it must
                    // not lose the stock that actually arrived.
                } finally {
                    image.close();
                }
                final String payload = b64;
                main.post(() -> {
                    if (payload != null) bidikanNota.add(payload);
                    // Panduan yang mengatur alurnya; bidikan berikutnya datang
                    // dari detaknya sendiri, bukan dari orang yang menekan.
                    if (panduanNotaAktif) return;
                    mulaiPanduanNota(resi);
                });
            }

            @Override public void onError(@NonNull ImageCaptureException e) {
                // Bidikan yang gagal tidak membatalkan yang sudah terkumpul.
                main.post(() -> {
                    if (panduanNotaAktif) return;
                    if (bidikanNota.isEmpty()) lanjutkanNota(resi);
                    else mulaiPanduanNota(resi);
                });
            }
        });
    }

    /**
     * Satu frame ikut memilih bahan apa yang ada di nota.
     *
     * Sama seperti nomor pesanan di scan resi packing: satu frame adalah
     * tebakan, beberapa frame yang sepakat adalah bukti.
     */
    private void catatBahanDariFrame(String teks) {
        if (!panduanNotaAktif || catalogue.isEmpty()) return;
        suaraBahan.catat(ProductMatcher.cariDiTeks(teks, catalogue, 3));
    }

    /**
     * Panduan nota, OTOMATIS.
     *
     * Menggantikan tawaran "Potret lagi" yang manual. Dialog itu menaruh
     * keputusan pada orang yang sedang memegang kardus dengan dua tangan, dan
     * menanyakannya berulang kali membuat orang menekan apa saja supaya cepat
     * selesai. Di sini kamera yang bekerja: terus membaca, memotret sendiri
     * berkala, dan berhenti sendiri begitu bahannya dikenali beberapa frame --
     * mekanisme yang sama dengan panduan bertahap di scan resi packing.
     */
    private void mulaiPanduanNota(String resi) {
        if (isFinishing() || isDestroyed()) return;
        panduanNotaAktif = true;
        panduanMulai = android.os.SystemClock.uptimeMillis();
        bidikanTerakhirAt = panduanMulai;
        suaraBahan.kosongkan();
        detakNota(resi);
    }

    private void detakNota(final String resi) {
        if (!panduanNotaAktif || isFinishing() || isDestroyed()) return;
        long t = android.os.SystemClock.uptimeMillis();
        long lewat = t - panduanMulai;
        int dikenali = suaraBahan.disepakati();

        hint.setText(dikenali > 0
                ? "Nota terbaca — " + dikenali + " bahan dikenali dari "
                  + suaraBahan.frame() + " frame"
                : "Arahkan ke daftar barang & nominal di nota — "
                  + suaraBahan.frame() + " frame");

        if (SuaraBahan.selesai(dikenali, lewat)) {
            panduanNotaAktif = false;
            lanjutkanNota(resi);
            return;
        }

        if (bidikanNota.size() < MAKS_BIDIKAN && t - bidikanTerakhirAt >= JEDA_BIDIK_MS) {
            bidikanTerakhirAt = t;
            focusThenCapture(resi);
        }
        main.postDelayed(() -> detakNota(resi), 250);
    }

    /** Menyatukan bidikan yang terkumpul, lalu membuka lembar pencocokan. */
    private void lanjutkanNota(String resi) {
        final List<String> bidikan = new ArrayList<>(bidikanNota);
        if (bidikan.size() <= 1) {
            map(resi, bidikan.isEmpty() ? null : bidikan.get(0));
            return;
        }
        // Di utas utama, penyusunan beberapa bitmap besar membekukan layar
        // beberapa detik tepat saat barang sedang diturunkan.
        hint.setText("Menyusun gambar...");
        cameraExecutor.execute(() -> {
            final String gabungan = GabungFrame.rakit(bidikan, null, PHOTO_QUALITY);
            main.post(() -> map(resi, gabungan != null ? gabungan : bidikan.get(0)));
        });
    }

    private String toBase64Jpeg(ImageProxy image) {
        ByteBuffer buffer = image.getPlanes()[0].getBuffer();
        byte[] bytes = new byte[buffer.remaining()];
        buffer.get(bytes);
        Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bmp == null) return null;

        int rotation = image.getImageInfo().getRotationDegrees();
        if (rotation != 0) {
            Matrix m = new Matrix();
            m.postRotate(rotation);
            Bitmap rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
            if (rotated != bmp) bmp.recycle();
            bmp = rotated;
        }
        int w = bmp.getWidth(), h = bmp.getHeight();
        float scale = PHOTO_MAX_EDGE / (float) Math.max(w, h);
        if (scale < 1f) {
            Bitmap small = Bitmap.createScaledBitmap(
                    bmp, Math.round(w * scale), Math.round(h * scale), true);
            if (small != bmp) bmp.recycle();
            bmp = small;
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, PHOTO_QUALITY, out);
        bmp.recycle();
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    /** The same shrink-and-encode as the camera path, from a chosen file. */
    private String toBase64Jpeg(Bitmap bmp) {
        int w = bmp.getWidth(), h = bmp.getHeight();
        float scale = PHOTO_MAX_EDGE / (float) Math.max(w, h);
        if (scale < 1f) {
            Bitmap small = Bitmap.createScaledBitmap(
                    bmp, Math.round(w * scale), Math.round(h * scale), true);
            if (small != bmp) bmp.recycle();
            bmp = small;
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, PHOTO_QUALITY, out);
        bmp.recycle();
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    /**
     * The chosen screenshot: stored, then read.
     *
     * The reading fills what it can and the packer keeps the last word, as
     * everywhere else here. A total read wrongly is one number to correct; a
     * total nobody entered is a wrong HPP for as long as the material lasts.
     */
    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ_ORDER_PHOTO) return;
        if (result != RESULT_OK || data == null || data.getData() == null) return;

        final String base64;
        try {
            java.io.InputStream in = getContentResolver().openInputStream(data.getData());
            Bitmap bmp = BitmapFactory.decodeStream(in);
            if (in != null) in.close();
            if (bmp == null) throw new Exception("bukan gambar");
            base64 = toBase64Jpeg(bmp);
        } catch (Exception e) {
            Toast.makeText(this, "Foto tidak bisa dibaca.", Toast.LENGTH_LONG).show();
            return;
        }
        if (pendingOrderButton != null) pendingOrderButton.setText("Membaca foto pesanan...");

        api.scanOrderPhoto(base64, r -> {
            if (!r.ok() || r.data() == null) {
                Toast.makeText(this, "Gagal mengunggah foto pesanan.", Toast.LENGTH_LONG).show();
                if (pendingOrderButton != null) {
                    pendingOrderButton.setText("Lampirkan foto pesanan");
                }
                return;
            }
            // Stored even when nothing was read: the evidence is the point,
            // the numbers can be typed.
            String url = r.data().optString("url", "");
            orderPhotoUrl = url.isEmpty() ? null : url;
            if (pendingOrderButton != null) {
                pendingOrderButton.setText("Foto pesanan terlampir");
            }

            org.json.JSONArray items = r.data().optJSONArray("items");
            int filled = 0;
            double total = 0;
            for (int i = 0; items != null && i < items.length(); i++) {
                org.json.JSONObject o = items.optJSONObject(i);
                if (o == null) continue;
                total += o.optDouble("totalCost", 0);
                // Only fills a line the packer already mapped. A screenshot
                // naming something not on this waybill is not a reason to
                // invent a delivery line.
                String matched = o.optString("matchedMaterialId", "");
                double qty = o.optDouble("quantity", 0);
                if (matched.isEmpty() || qty <= 0 || pendingRows == null) continue;
                for (Row row : pendingRows) {
                    if (row.removed || row.chosen < 0 || row.chosen >= row.options.size()) continue;
                    if (matched.equals(row.options.get(row.chosen).id) && row.pcsField != null) {
                        row.pcsField.setText(String.valueOf((long) qty));
                        filled++;
                        break;
                    }
                }
            }
            if (total > 0 && pendingAmountField != null
                    && pendingAmountField.getText().toString().trim().isEmpty()) {
                pendingAmountField.setText(String.valueOf((long) total));
            }
            if (pendingOrderNote != null) {
                pendingOrderNote.setText(filled == 0 && total <= 0
                        ? "Foto tersimpan, tapi jumlah dan nominal tidak terbaca - isi manual."
                        : "Terbaca " + filled + " baris jumlah"
                          + (total > 0 ? ", total Rp " + (long) total : "")
                          + ". Periksa sebelum simpan.");
            }
        });
    }

    /** One mapped line: which material, how many packages, how much in each. */
    private static final class Row {
        final String rawName;
        final List<ProductMatcher.Product> options;
        int chosen = 0;
        EditText pcsField;
        EditText contentField;
        /** Which unit the CONTENT box is measured in — the packer's choice. */
        Spinner unitSpinner;
        /** "2 pcs x 1 kg = 2.000 gram", recomputed as either box changes. */
        TextView preview;
        /** The whole block, so deleting the line can take all of it away. */
        View container;
        /** Set when the packer removed the line; submit skips it. */
        boolean removed = false;

        Row(String rawName, List<ProductMatcher.Product> options) {
            this.rawName = rawName;
            this.options = options;
        }
    }

    /**
     * The sheet. Every line the waybill offered, with the closest material
     * already selected — and never accepted without being looked at, because a
     * wrong mapping here does not fail loudly, it silently credits the wrong
     * shelf.
     */
    private void map(String resi, String photoBase64) {
        hint.setText("Cocokkan bahan yang datang.");
        if (catalogue.isEmpty()) {
            Toast.makeText(this, "Master bahan baku belum termuat.", Toast.LENGTH_LONG).show();
            reset();
            return;
        }

        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);
        final List<Row> rows = new ArrayList<>();

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        // Editable, because with every symbology now accepted a carton can
        // offer several codes and the wrong one can win. Showing what was read
        // and letting it be corrected costs one field; getting it wrong means a
        // stock movement filed under a number that identifies nothing.
        TextView resiLabel = new TextView(this);
        resiLabel.setText("Nomor resi");
        resiLabel.setTextSize(11);
        resiLabel.setTextColor(Color.parseColor("#6B7178"));
        root.addView(resiLabel);

        final EditText resiField = new EditText(this);
        resiField.setText(resi);
        resiField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        root.addView(resiField);

        final LinearLayout rowsBox = new LinearLayout(this);
        rowsBox.setOrientation(LinearLayout.VERTICAL);
        root.addView(rowsBox);

        // Seluruh teks dicari ke master BAHAN BAKU, sekali untuk semua baris.
        //
        // Alasannya sama dengan di scan resi packing: OCR memotong baris
        // menurut tata letak cetakan, bukan menurut arti, sehingga nama bahan
        // rutin terbelah atau menyatu dengan alamat. Yang membedakan di sini
        // katalognya -- bahan baku, bukan produk jadi.
        final List<ProductMatcher.Match> dariTeks =
                ProductMatcher.cariDiTeks(collector.lines().toString(), catalogue, 5);

        for (String line : collector.lines()) {
            // Character-level first: whole words rarely survive these photos,
            // and word matching is what left this sheet empty.
            // A supplier's wording repeats across their deliveries, so a
            // material answered once is answered for good.
            String rememberedId = FuzzyMatch.recall("material", line);
            FuzzyMatch.Scored best = null;
            if (rememberedId != null) {
                for (ProductMatcher.Product p : catalogue) {
                    if (p.id.equals(rememberedId)) { best = new FuzzyMatch.Scored(p, 1.0); break; }
                }
            }
            if (best == null) best = FuzzyMatch.best(line, catalogue);
            List<ProductMatcher.Product> opts = new ArrayList<>();
            if (best != null) {
                opts.add(best.product);
                // Yang ditemukan dari seluruh teks ditaruh tepat di belakang
                // pilihan terbaik, bukan di ekor 31 bahan: kalau tebakan
                // pertama meleset, yang benar tinggal satu ketukan.
                tambahDariTeks(opts, dariTeks);
                for (ProductMatcher.Product other : catalogue) {
                    if (!berisi(opts, other.id)) opts.add(other);
                }
            } else {
                List<ProductMatcher.Match> ranked = ProductMatcher.rank(line, catalogue, 5);
                for (ProductMatcher.Match m : ranked) opts.add(m.product);
                tambahDariTeks(opts, dariTeks);
                if (opts.isEmpty()) continue;
            }
            addRow(rowsBox, rows, line, opts, d);
            if (rows.size() >= 8) break;
        }

        // Nothing per line. Try the whole reading at once: a material named
        // across two lines is invisible to line-by-line matching.
        if (rows.isEmpty() && !dariTeks.isEmpty()) {
            List<ProductMatcher.Product> opts = new ArrayList<>();
            tambahDariTeks(opts, dariTeks);
            for (ProductMatcher.Product other : catalogue) {
                if (!berisi(opts, other.id)) opts.add(other);
            }
            addRow(rowsBox, rows, null, opts, d);
        }

        if (rows.isEmpty()) {
            FuzzyMatch.Scored whole = FuzzyMatch.best(collector.lines().toString(), catalogue);
            if (whole != null) {
                List<ProductMatcher.Product> opts = new ArrayList<>();
                opts.add(whole.product);
                for (ProductMatcher.Product other : catalogue) {
                    if (!other.id.equals(whole.product.id)) opts.add(other);
                }
                addRow(rowsBox, rows, null, opts, d);
            }
        }

        MaterialButton add = new MaterialButton(this);
        add.setText("+ Tambah bahan");
        add.setAllCaps(false);
        add.setOnClickListener(v -> addRow(rowsBox, rows, null, catalogue, d));
        root.addView(add);

        if (rows.isEmpty()) {
            TextView none = new TextView(this);
            none.setText("Tidak ada nama bahan yang dikenali dari resi. Tambahkan sendiri di atas.");
            none.setTextSize(12);
            rowsBox.addView(none);
        }

        // COD last, because it is about the parcel rather than any line in it.
        final CheckBox cod = new CheckBox(this);
        cod.setText("Bayar COD di tempat");
        cod.setPadding(0, (int) (14 * d), 0, 0);
        root.addView(cod);

        // Always visible. It used to appear only for COD, so a parcel paid by
        // transfer — the commoner case — arrived priceless and its materials
        // carried no cost into the HPP. The label changes; the field does not
        // come and go.
        final EditText codAmount = new EditText(this);
        codAmount.setInputType(InputType.TYPE_CLASS_NUMBER);
        codAmount.setHint("Nominal pembelian (Rp)");
        root.addView(codAmount, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        final TextView codNote = new TextView(this);
        codNote.setTextSize(11);
        codNote.setTextColor(Color.parseColor("#6B7178"));
        codNote.setText("Nominal dipakai sebagai harga bahan bila resi ini "
                + "hanya berisi satu bahan.");
        root.addView(codNote);

        // Jalan keluar yang harus dicentang sadar.
        //
        // Nominal wajib, tapi kadang benar-benar tidak ada yang tahu harganya
        // saat paketnya sampai. Menolak seluruh kedatangan karena satu angka
        // akan menghilangkan catatan barang yang fisiknya sudah di rak. Jadi
        // yang dilarang bukan menyimpan tanpa harga -- yang dilarang adalah
        // menyimpannya tanpa sadar.
        final CheckBox hargaBelumTahu = new CheckBox(this);
        hargaBelumTahu.setText("Harga belum diketahui, isi nanti");
        root.addView(hargaBelumTahu);

        final TextView belumTahuNote = new TextView(this);
        belumTahuNote.setTextSize(11);
        belumTahuNote.setTextColor(Color.parseColor("#B3261E"));
        belumTahuNote.setVisibility(View.GONE);
        belumTahuNote.setText("Bahan ini akan masuk rak tanpa harga, jadi HPP produk "
                + "yang memakainya dihitung lebih murah dari biaya sebenarnya. "
                + "Pembelian ini muncul di Data Belum Lengkap sampai harganya diisi.");
        root.addView(belumTahuNote);

        hargaBelumTahu.setOnCheckedChangeListener((v, checked) ->
                belumTahuNote.setVisibility(checked ? View.VISIBLE : View.GONE));

        cod.setOnCheckedChangeListener((v, checked) -> {
            codAmount.setHint(checked ? "Nominal COD (Rp)" : "Nominal pembelian (Rp)");
            // Said plainly, because it decides whether HPP learns anything from
            // this delivery: one material means the amount IS its price.
            codNote.setText(rows.size() == 1
                    ? "Nominal ini jadi harga bahan tersebut."
                    : "Resi berisi beberapa bahan — nominal dicatat sebagai total, "
                      + "harga rata-rata tiap bahan tidak diubah.");
        });

        // The order detail from the marketplace. A courier label carries
        // neither a quantity nor a price; the order screen carries both, and
        // for a parcel paid by transfer it is the only place they exist.
        final MaterialButton orderBtn = new MaterialButton(this, null,
                com.google.android.material.R.attr.materialButtonOutlinedStyle);
        orderBtn.setText("Lampirkan foto pesanan");
        orderBtn.setAllCaps(false);
        final TextView orderNote = new TextView(this);
        orderBtn.setOnClickListener(ob -> {
            // The picker leaves this activity, so the parts the reading has to
            // fill are parked where onActivityResult can reach them.
            pendingRows = rows;
            pendingAmountField = codAmount;
            pendingOrderButton = orderBtn;
            pendingOrderNote = orderNote;
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.setType("image/*");
            try {
                startActivityForResult(
                        Intent.createChooser(pick, "Pilih foto pesanan"), REQ_ORDER_PHOTO);
            } catch (Exception e) {
                Toast.makeText(this, "Tidak ada aplikasi galeri.", Toast.LENGTH_LONG).show();
            }
        });
        root.addView(orderBtn, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        orderNote.setTextSize(11);
        orderNote.setTextColor(Color.parseColor("#6B7178"));
        orderNote.setText("Screenshot detail pesanan dibaca untuk mengisi jumlah dan "
                + "nominal, lalu disimpan sebagai bukti.");
        root.addView(orderNote);

        ScrollView sv = new ScrollView(this);
        sv.addView(root);

        final androidx.appcompat.app.AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setTitle("Bahan Datang — " + resi)
                .setView(sv)
                .setCancelable(false)
                .setPositiveButton("Simpan", null)
                .setNegativeButton("Batal", (d2, w) -> reset())
                .create();

        // Wired after show(), so a refusal leaves the sheet exactly as the
        // packer left it. Handed to the builder, the dialog dismisses before
        // the listener runs, and every failure path here had to rebuild the
        // sheet from the reading -- discarding the mapping it claimed to save.
        dialog.setOnShowListener(dd ->
                dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(bv -> {
                    String finalResi = ResiExtractor.normalize(resiField.getText().toString());
                    if (finalResi.length() < 6) {
                        Toast.makeText(this, "Nomor resi terlalu pendek.", Toast.LENGTH_LONG).show();
                        return;
                    }
                    boolean isCod = cod.isChecked();
                    double amount = parse(codAmount, 0);
                    if (isCod && amount <= 0) {
                        // COD tidak punya versi "belum diketahui": uangnya
                        // baru saja diserahkan ke kurir, jadi angkanya ada.
                        Toast.makeText(this, "Nominal COD wajib diisi.", Toast.LENGTH_LONG).show();
                        return;
                    }
                    if (!isCod && amount <= 0 && !hargaBelumTahu.isChecked()) {
                        // Inti perubahannya. Dulu baris ini tidak ada, dan
                        // nominal yang terlupa lolos diam-diam -- terukur: 7
                        // dari 25 pembelian tercatat tanpa harga.
                        Toast.makeText(this,
                                "Nominal pembelian wajib diisi. Kalau memang belum tahu "
                                        + "harganya, centang \"Harga belum diketahui\".",
                                Toast.LENGTH_LONG).show();
                        return;
                    }
                    // Nominal tetap dikirim kalau terisi, meski kotak "belum
                    // diketahui" tercentang: centangnya membebaskan kewajiban,
                    // bukan membuang angka yang terlanjur ada.
                    // Only a sheet the server will accept closes the dialog.
                    if (submit(finalResi, photoBase64, rows, isCod, amount)) {
                        dialog.dismiss();
                    }
                }));
        dialog.show();
    }

    /** Sudah ada di daftar pilihan? */
    private static boolean berisi(List<ProductMatcher.Product> opts, String id) {
        for (ProductMatcher.Product p : opts) if (p.id.equals(id)) return true;
        return false;
    }

    /** Menyisipkan hasil pencarian seluruh teks, urut, tanpa menggandakan. */
    private static void tambahDariTeks(List<ProductMatcher.Product> opts,
                                       List<ProductMatcher.Match> dariTeks) {
        for (ProductMatcher.Match m : dariTeks) {
            if (!berisi(opts, m.product.id)) opts.add(m.product);
        }
    }

    private void addRow(final LinearLayout box, List<Row> rows, String rawName,
                        List<ProductMatcher.Product> options, final float d) {
        final Row row = new Row(rawName, new ArrayList<>(options));
        rows.add(row);

        final LinearLayout block = new LinearLayout(this);
        block.setOrientation(LinearLayout.VERTICAL);
        block.setPadding(0, (int) (10 * d), 0, (int) (10 * d));
        row.container = block;
        box.addView(block);

        // The label and the way out of it on the same line. A line the reader
        // invented from a shadow, or a second entry for a material already
        // listed, previously had to be neutralised by setting its count to
        // something harmless — which is a trick, not a control.
        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);

        TextView label = new TextView(this);
        label.setText(rawName == null
                ? "Ditambahkan sendiri"
                : "Di resi: " + (rawName.length() > 70 ? rawName.substring(0, 70) + "…" : rawName));
        label.setTextSize(11);
        label.setTextColor(Color.parseColor("#6B7178"));
        head.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        MaterialButton del = new MaterialButton(this, null,
                com.google.android.material.R.attr.materialButtonOutlinedStyle);
        del.setText("Hapus");
        del.setAllCaps(false);
        del.setTextSize(11);
        del.setOnClickListener(v -> {
            row.removed = true;
            box.removeView(block);
        });
        head.addView(del);
        block.addView(head);

        List<String> names = new ArrayList<>();
        for (ProductMatcher.Product p : row.options) names.add(p.name);
        // Searchable: this catalogue holds near-identical neighbours — "Label
        // Sticker", "Label Stiker" and "Stiker" are three separate rows — and
        // finding the right one by scrolling is guesswork.
        Picker picker = Picker.create(this, names, "Pilih bahan baku", "— pilih bahan —");
        picker.select(0);
        picker.onPicked(idx -> {
            row.chosen = idx;
            // A different material can be held in a different unit, so the
            // picker beside the content box has to follow the choice.
            refreshUnits(row, d);
        });
        block.addView(picker.view(), new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout qtyRow = new LinearLayout(this);
        qtyRow.setOrientation(LinearLayout.HORIZONTAL);

        EditText pcs = new EditText(this);
        pcs.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        pcs.setHint("jumlah pcs");
        pcs.setText("1");
        row.pcsField = pcs;
        qtyRow.addView(pcs, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        EditText content = new EditText(this);
        content.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        content.setHint("isi per pcs");
        row.contentField = content;
        qtyRow.addView(content, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        // The unit the BOX is labelled in, which is not always the unit the
        // catalogue counts in. Asking is the whole fix: a 1 kg jug typed into
        // a field labelled "gram" adds one gram and looks entirely normal.
        Spinner unitSp = new Spinner(this);
        row.unitSpinner = unitSp;
        qtyRow.addView(unitSp, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        block.addView(qtyRow);

        TextView preview = new TextView(this);
        preview.setTextSize(11);
        preview.setPadding(0, (int) (4 * d), 0, 0);
        row.preview = preview;
        block.addView(preview);

        TextWatcher watch = new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b2, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b2, int c) {}
            @Override public void afterTextChanged(Editable s) { refreshPreview(row); }
        };
        pcs.addTextChangedListener(watch);
        content.addTextChangedListener(watch);

        refreshUnits(row, d);
    }

    /** The catalogue's unit for whichever material this row currently names. */
    private String unitOf(Row row) {
        if (row.chosen < 0 || row.chosen >= row.options.size()) return "";
        String u = units.get(row.options.get(row.chosen).id);
        return u == null || u.isEmpty() ? "" : u;
    }

    /** What the packer says the content box is measured in. */
    private String enteredUnitOf(Row row) {
        if (row.unitSpinner == null) return unitOf(row);
        Object sel = row.unitSpinner.getSelectedItem();
        return sel == null ? unitOf(row) : sel.toString();
    }

    /**
     * Rebuild the unit picker after the material changes.
     *
     * The catalogue's own unit is offered first and preselected, because most
     * deliveries really do arrive in it and the common case should be the one
     * that needs no thought.
     */
    private void refreshUnits(Row row, float d) {
        if (row.unitSpinner == null) return;
        String target = unitOf(row);
        List<String> opts = Units.compatible(target);
        if (opts.isEmpty()) opts = new ArrayList<>(List.of(target.isEmpty() ? "satuan" : target));
        row.unitSpinner.setAdapter(new ArrayAdapter<>(
                this, android.R.layout.simple_spinner_dropdown_item, opts));
        row.unitSpinner.setSelection(0);
        row.unitSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                refreshPreview(row);
            }
            @Override public void onNothingSelected(AdapterView<?> p) {}
        });
        refreshPreview(row);
    }

    /**
     * Say what will actually reach the shelf, before it does.
     *
     * The arithmetic is not hard, but it is invisible, and an invisible
     * thousandfold error is exactly the kind that survives to the stocktake.
     */
    private void refreshPreview(Row row) {
        if (row.preview == null) return;
        String target = unitOf(row);
        String from = enteredUnitOf(row);
        double pcs = parse(row.pcsField, 0);
        double content = parse(row.contentField, 1);
        if (content <= 0) content = 1;

        Double per = Units.convert(content, from, target);
        if (per == null) {
            row.preview.setText("Satuan \"" + from + "\" tidak bisa diubah ke \"" + target + "\".");
            row.preview.setTextColor(Color.parseColor("#B3261E"));
            return;
        }
        if (pcs <= 0) {
            row.preview.setText("");
            return;
        }
        row.preview.setText("= " + Units.describe(pcs * per, target) + " masuk ke stok");
        row.preview.setTextColor(Color.parseColor("#1B7F4B"));
    }

    /**
     * Send the parcel, or refuse and say why.
     *
     * Returns false when the sheet is not ready, so the caller can keep the
     * dialog open instead of dismissing it over a mistake the packer is
     * standing right there to fix.
     */
    private boolean submit(String resi, String photoBase64, List<Row> rows,
                        boolean isCod, double amount) {
        JSONArray items = new JSONArray();
        // A row left blank is not a row to be dropped silently. Until now a
        // sheet with four lines and one filled in saved as a one-line parcel,
        // and nothing said the other three had gone.
        int blank = 0;
        for (Row r : rows) {
            if (r.removed) continue;
            if (r.chosen < 0 || r.chosen >= r.options.size()) continue;
            if (parse(r.pcsField, 0) <= 0) blank++;
        }
        if (blank > 0) {
            Toast.makeText(this,
                    blank + " baris belum diisi jumlahnya. Isi, atau hapus barisnya.",
                    Toast.LENGTH_LONG).show();
            return false;
        }

        for (Row r : rows) {
            if (r.removed) continue;
            if (r.chosen < 0 || r.chosen >= r.options.size()) continue;
            double pcs = parse(r.pcsField, 0);
            if (pcs <= 0) continue;
            // Blank means one unit per package, which is what "pcs" materials
            // always are. Zero would add nothing at all.
            double content = parse(r.contentField, 1);
            if (content <= 0) content = 1;
            try {
                JSONObject o = new JSONObject();
                o.put("materialId", r.options.get(r.chosen).id);
                if (r.rawName != null) o.put("rawName", r.rawName);
                o.put("qtyPcs", pcs);
                o.put("contentPerPcs", content);
                // The server converts rather than the phone, so a phone that
                // has not been updated cannot quietly write a wrong figure —
                // and the entry as typed is what gets stored beside it.
                o.put("contentUnit", enteredUnitOf(r));
                items.put(o);
            } catch (Exception ignored) {}
        }
        if (items.length() == 0) {
            // Not reset(): the sheet stays open. A parcel that reached this
            // screen physically exists, and throwing the packer back to the
            // camera loses the photo and the reading along with the mistake.
            Toast.makeText(this,
                    "Belum ada bahan yang dipetakan ke master. Pilih bahannya dulu.",
                    Toast.LENGTH_LONG).show();
            return false;
        }

        hint.setText("Menyimpan...");
        // The amount goes as codAmount only when it was COD, and as totalCost
        // always: on a COD parcel they are the same figure, and on a paid one
        // only the total exists.
        api.recordDelivery(resi, photoBase64, collector.lines().toString(), items,
                isCod, isCod ? amount : -1, amount, orderPhotoUrl, r -> {
            // The reply names any line the server refused on units; without
            // this the packer sees "saved" and a shelf short of one material.
            if (r.ok()) {
                StringBuilder sb = new StringBuilder("Stok bertambah:");
                final StringBuilder contents = new StringBuilder();
                JSONArray arr = r.data() == null ? null : r.data().optJSONArray("items");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject o = arr.optJSONObject(i);
                        if (o == null) continue;
                        String line = o.optString("name") + " — " + trimNumber(o.optDouble("qty", 0))
                                + " " + o.optString("unit", "");
                        sb.append("\n• ").append(line);
                        contents.append("• ").append(line).append("\n");
                    }
                }

                AlertDialog.Builder done = new MaterialAlertDialogBuilder(this)
                        .setTitle("Tersimpan")
                        .setMessage(sb.toString())
                        .setPositiveButton("Lanjut", (d, w) -> reset());
                if (isCod) {
                    // Only for COD: somebody has to be asked to pay, and asking
                    // is the step most easily forgotten once the parcel is open.
                    done.setNeutralButton("Minta Bayar (WhatsApp)", (d, w) -> {
                        shareCod(resi, amount, contents.toString());
                        reset();
                    });
                }
                done.show();
                return;
            }
            if (r.code == 409) {
                // "Already reported" with no date leaves the packer wondering
                // whether they did it or somebody else did, an hour ago or last
                // week — and the server already knows.
                String when = r.body == null ? null
                        : Format.humanTime(r.body.optString("firstReportedAt", null));
                new MaterialAlertDialogBuilder(this)
                        .setTitle("Sudah pernah dilaporkan")
                        .setMessage("Resi " + resi + " sudah tercatat"
                                + (when == null ? "" : " " + when)
                                + ".\n\nStok tidak ditambahkan dua kali. Kalau ini paket yang "
                                + "berbeda, periksa nomor resinya.")
                        .setPositiveButton("Mengerti", (d, w2) -> reset())
                        .show();
                return;
            } else {
                Toast.makeText(this, r.message("Gagal menyimpan laporan."), Toast.LENGTH_LONG).show();
            }
            reset();
        });
        // The sheet was complete and the request is away. Whether the server
        // takes it is answered above, on screen, by the callback.
        return true;
    }

    /**
     * Ask finance to pay the courier.
     *
     * Sent as a message rather than recorded as a task because that is where
     * the answer comes from — the person who pays is on WhatsApp, not in this
     * app, and a request nobody sees is not a request. Everything they need to
     * approve it is in the text: which parcel, how much, and what was in it.
     */
    private void shareCod(String resi, double amount, String contents) {
        String text = "*Permintaan Pembayaran COD — Bahan Baku*\n"
                + "Resi: " + resi + "\n"
                + "Tanggal: " + new java.text.SimpleDateFormat("d MMM yyyy",
                        new java.util.Locale("id", "ID")).format(new java.util.Date()) + "\n"
                + "Nominal COD: Rp " + String.format(new java.util.Locale("id", "ID"), "%,.0f", amount)
                + "\n\nIsi paket:\n" + contents
                + "\nMohon dibayarkan ke kurir/supplier.";

        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        try {
            send.setPackage("com.whatsapp");
            startActivity(send);
        } catch (Exception e) {
            send.setPackage(null);
            startActivity(Intent.createChooser(send, "Bagikan lewat"));
        }
    }

    /** 3.0 reads as 3; 2.5 stays 2.5. Warehouse quantities are mostly whole. */
    private static String trimNumber(double v) {
        if (v == Math.rint(v)) return String.valueOf((long) v);
        return String.valueOf(v);
    }

    private static double parse(EditText f, double fallback) {
        if (f == null) return fallback;
        try {
            String s = f.getText().toString().trim().replace(",", ".");
            if (s.isEmpty()) return fallback;
            return Double.parseDouble(s);
        } catch (Exception e) {
            return fallback;
        }
    }

    private void promptManual() {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        input.setHint("Nomor resi bahan baku");
        new MaterialAlertDialogBuilder(this)
                .setTitle("Input Resi Manual")
                .setView(input)
                .setPositiveButton("Lanjut", (d, w) -> {
                    String v = ResiExtractor.normalize(input.getText().toString());
                    if (v.length() < 6) {
                        Toast.makeText(this, "Nomor resi terlalu pendek.", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    busy = true;
                    status.setText(v);
                    capture(v);
                })
                .setNegativeButton("Batal", null)
                .show();
    }

    /**
     * The warehouse light is not always on the packer's side.
     *
     * Cheap to offer and it helps twice: the barcode decodes from a sharper
     * image, and so does the text the material names are matched from.
     */
    private void toggleTorch() {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) {
            Toast.makeText(this, "Lampu tidak tersedia di kamera ini.", Toast.LENGTH_SHORT).show();
            return;
        }
        torchOn = !torchOn;
        camera.getCameraControl().enableTorch(torchOn);
        ((com.google.android.material.button.MaterialButton) findViewById(R.id.dlTorch))
                .setText(torchOn ? "Lampu: Nyala" : "Lampu");
    }

    private void reset() {
        busy = false;
        // Bidikan nota sebelumnya yang terbawa akan menempelkan gambar
        // pengiriman yang salah ke pengiriman berikutnya.
        bidikanNota.clear();
        panduanNotaAktif = false;
        suaraBahan.kosongkan();
        lookingSince = android.os.SystemClock.uptimeMillis();
        collector.reset();
        status.setText("Siap");
        hint.setText("Arahkan ke barcode resi bahan baku yang datang.");
        read.setVisibility(View.GONE);
    }
}

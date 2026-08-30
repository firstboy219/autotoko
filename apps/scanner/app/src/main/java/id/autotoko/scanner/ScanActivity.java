package id.autotoko.scanner;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.text.InputType;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
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
import android.util.Range;
import androidx.camera.core.ExposureState;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.MeteringPoint;
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
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Point the camera at the label; the parcel records itself.
 *
 * The waybill comes from the BARCODE, not from OCR. Every courier label
 * carries one, and it decodes to the exact number with no guessing — which is
 * what makes hands-free operation safe. Reading the digits visually was always
 * a guess, and a guess is not something to auto-submit when the server refuses
 * duplicates: a wrong number silently occupies a key the real parcel needs.
 *
 * A still photo of the label is captured and uploaded with the scan. The
 * server reads it later, off the packer's critical path, to recover the order
 * number, recipient and contents. None of that is worth standing still for;
 * the barcode already answered the only question that matters right now.
 *
 * So there is no Save button. Beep, and the packer is already reaching for the
 * next parcel. Two distinct sounds: a short rising tone for recorded, a longer
 * error tone for a duplicate, because in a warehouse the phone is not being
 * looked at.
 */
@ExperimentalGetImage
public class ScanActivity extends AppCompatActivity {

    private static final int REQ_CAMERA = 101;
    /** Ignore the same barcode for this long: it stays in frame after a scan. */
    private static final long REPEAT_MUTE_MS = 5000;
    /**
     * Longest edge of the uploaded photo.
     *
     * Was 1600 across the whole frame, which is why the first real scans came
     * back as unreadable noise: the label filled maybe 40% of the picture, so
     * its text landed at roughly 9 pixels tall. Tesseract needs about 20.
     * Cropping to the label and keeping this much resolution puts character
     * height back in the range where OCR has a chance.
     */
    private static final int PHOTO_MAX_EDGE = 2560;
    private static final int PHOTO_QUALITY = 85;

    /**
     * How far past the barcode the label extends, in multiples of the
     * barcode's own size. Measured off real Tokopedia and Shopee labels: the
     * barcode sits in the upper third, with the address block above it and the
     * product table well below. Generous on purpose - including some cardboard
     * costs almost nothing, while clipping the product table loses the very
     * thing we photograph the label for.
     */
    private static final float CROP_SIDE = 1.0f;
    private static final float CROP_ABOVE = 3.0f;
    private static final float CROP_BELOW = 8.0f;

    /** Let autofocus settle before the shutter; the first scans were blurred. */
    private static final long FOCUS_SETTLE_MS = 700;

    /** Stops on the meter, negative. See dimForTheLabel(). */
    private static final double EXPOSURE_EV = -1.0;

    /**
     * How sharp the picture has to be before the shutter fires, as the
     * percentage shown on screen.
     *
     * The whole point of the photo is that a server reads the small print off
     * it, and blur is what stops that -- a soft photo is unreadable no matter
     * how many pixels it has. Measuring before the shutter is the only cheap
     * moment to catch it: afterwards the parcel has gone in the box.
     */
    private static final int CLARITY_MIN = 60;

    /**
     * How long to keep waiting for a steady shot before giving up and taking
     * it anyway.
     *
     * Never blocks a scan outright. The waybill came from the barcode and is
     * already exact, so refusing to record the parcel because its photograph
     * is soft would throw away the reliable half to protect the unreliable
     * one. Past this the picture is taken and the packer is told it was blurry.
     */
    private static final long CLARITY_WAIT_MS = 3000;

    /** Samples per axis. Enough to judge focus, cheap enough for every frame. */
    private static final int CLARITY_SAMPLES = 96;

    /**
     * Half-way point of the clarity scale: a Laplacian variance of this reads
     * as 50%. Chosen so a label held steadily at arm's length lands above
     * CLARITY_MIN and a hand-waved one lands well below; it is the number to
     * turn if the meter turns out to be too strict or too generous in the
     * warehouse.
     */
    private static final double CLARITY_HALF = 100.0;

    /** Don't re-measure on every frame; focus does not move that fast. */
    private static final long CLARITY_INTERVAL_MS = 90;

    /** Fraction of the frame measured, centred: where the label is aimed. */
    private static final float CLARITY_REGION = 0.55f;

    /**
     * Resolution the analyser runs at.
     *
     * CameraX defaults to about 640x480, which is plenty for a barcode — big,
     * high-contrast, error-corrected — and hopeless for 6pt print. Reading the
     * label's text at that size was never going to work regardless of which
     * OCR engine looked at it. 1080p puts the product table and the order
     * number back above the size where characters are distinguishable.
     */
    private static final android.util.Size ANALYSIS_SIZE = new android.util.Size(1920, 1080);

    /**
     * Keep gathering frames for at least this long once a barcode is found,
     * even if the picture is already sharp.
     *
     * A single frame is a guess; several frames disagreeing in different places
     * is a correction. Under a second of standing still buys the difference
     * between reading an order number and not.
     */
    private static final long READ_MIN_MS = 700;

    /** ...and at least this many readings, if they arrive faster than that. */
    private static final int READ_MIN_FRAMES = 3;

    /**
     * How many consecutive label lines may be joined into one product name.
     *
     * A listing title routinely prints across several lines — a real Shopee
     * label put one product across five — and scored a line at a time every
     * fragment looks like noise and nothing matches. Three covers what has
     * actually been seen without letting two different products merge.
     */
    private static final int MERGE_MAX = 3;

    /** Enough for any parcel; past this the reading is noise, not contents. */
    private static final int MAX_ITEMS_PER_SCAN = 6;

    /** How long "SELESAI" stays up before the screen returns to ready. */
    private static final long DONE_HOLD_MS = 1800;

    private PreviewView preview;
    private TextView status, detail, counter, hint, clarityText, liveRead;
    private android.widget.ProgressBar clarityBar;
    private View banner;
    private TextView bannerText;

    private Session session;
    private Api api;
    private BarcodeScanner scanner;
    private ImageCapture imageCapture;
    private ExecutorService cameraExecutor;
    private final Handler main = new Handler(Looper.getMainLooper());

    private androidx.camera.core.Camera camera;
    /** Barcode position as a fraction of the upright frame, for cropping. */
    /** The seller's shops, for the mapping sheet. Loaded once at launch. */
    private final List<String[]> shopList = new ArrayList<>();   // {id, name, marketplace}
    private final List<String> courierList = new ArrayList<>();
    /** Remembered between parcels: a bench usually packs one shop all morning. */
    private int lastShopIndex = -1;
    private int lastCourierIndex = -1;
    /**
     * Every barcode decoded while looking at this one label.
     *
     * A courier label carries several — the waybill plus sort and reference
     * codes — and only one becomes the resi. Sending the rest is what lets the
     * server recognise a second scan of the same parcel when a different code
     * happened to win. Insertion-ordered so the first seen stays first.
     */
    /**
     * Readings this tenant has already answered: normalised text to product id.
     *
     * Consulted before any scoring. A remembered answer is not a better guess,
     * it is not a guess — the packer settled that exact reading themselves.
     */
    private final java.util.LinkedHashMap<String, String> ocrMemory = new java.util.LinkedHashMap<>();
    private final java.util.LinkedHashSet<String> seenCodes = new java.util.LinkedHashSet<>();
    /**
     * How close another barcode must be, as a fraction of the frame, to count
     * as printed on the same label.
     *
     * Tight on purpose. Too small only weakens the duplicate guard; too large
     * files a neighbour's code against this parcel and then refuses that
     * neighbour when it is scanned for real.
     */
    private static final double SAME_LABEL_RADIUS = 0.30;
    /** A label has a handful, not dozens; a runaway count means bad reads. */
    private static final int MAX_CODES_PER_LABEL = 8;
    private boolean torchOn = false;
    private volatile RectF lastBarcodeBox = null;

    private volatile int frameWidth = 0;
    private volatile int frameHeight = 0;
    private volatile boolean analysing = false;
    private volatile boolean busy = false;
    /** Latest reading, 0-100. Written on the camera thread, read on main. */
    private volatile int clarity = 0;
    private volatile long clarityAt = 0;
    /** Set when a photo was taken below CLARITY_MIN, to say so afterwards. */
    private boolean tookBlurred = false;

    private TextRecognizer textRecognizer;
    /** Accumulates readings of the label across frames; see LabelReader. */
    private final LabelReader reader = new LabelReader();
    /**
     * Setiap frame ikut memilih nomor pesanan.
     *
     * Di hasil tes tercatat 154 frame atas satu label, dan keputusannya
     * diambil dari satu frame yang kebetulan sedang dilihat. Ratusan
     * pembacaan bebas atas kertas yang sama adalah bukti; membuangnya lalu
     * berkata "belum terbaca" adalah membuang jawabannya sendiri.
     */
    private final SuaraOrderId suara = new SuaraOrderId();

    /**
     * Resi yang dibaca dari TULISAN, saat barcode-nya tidak terbaca.
     *
     * Sejak awal seluruh scan bersumber barcode: kalau barcode rusak,
     * terlipat, atau tertutup lakban, satu-satunya jalan adalah mengetik.
     * Di korpus, nomor resinya ada utuh di dalam teks OCR pada 79% scan --
     * yang dibutuhkan cuma membacanya.
     */
    private final java.util.HashMap<String, Integer> resiTulisan = new java.util.HashMap<>();
    private long menganggurSejak = 0;
    private long teksMenganggurAt = 0;
    private boolean tawaranResiDitolak = false;
    private boolean tawaranResiTampil = false;

    /** Sesudah selama ini tanpa barcode, tulisannya mulai ikut dibaca. */
    private static final long MULAI_BACA_TULISAN_MS = 2500;
    /** Jeda antar pembacaan teks saat menganggur, supaya barcode tetap lancar. */
    private static final long JEDA_TULISAN_MS = 500;
    /** Sebanyak ini frame harus sepakat sebelum ditawarkan. */
    private static final int SUARA_RESI_MIN = 3;

    /** Barcode nomor pesanan yang terlihat sebelum resinya ketemu. */
    private String pesananDariBarcode = null;

    /**
     * Untaian ini nomor PESANAN, bukan nomor pengiriman.
     *
     * Dipakai supaya barcode nomor pesanan tidak pernah mengisi kolom resi.
     * Syarat keduanya perlu: bentuknya dikenali sebagai nomor pesanan DAN
     * awalannya bukan awalan kurir -- tanpa syarat kedua, nomor pengiriman
     * berupa angka panjang bisa ikut tersingkir.
     */
    private static boolean bentukNomorPesanan(String v) {
        return OrderId.skorkan(v, false, false) != null && !ResiExtractor.berawalanResi(v);
    }
    /** The seller's own products, fetched once, matched against on every scan. */
    private final List<ProductMatcher.Product> catalogue = new ArrayList<>();
    /** True between finding the barcode and taking the photo: gather text now. */
    private volatile boolean collecting = false;

    /* ------------------------------------------------------ scan bertahap */

    /**
     * Satu resi, beberapa bidikan dekat.
     *
     * Sebelumnya satu jepretan harus menanggung semuanya sekaligus: nomor
     * pesanan, nama toko, kurir, dan daftar produk — dari jarak yang cukup
     * jauh untuk memuat seluruh label. Hasilnya bisa dilihat di datanya
     * sendiri: order id terbaca pada 7% resi saja.
     *
     * Tahap wajib hanya yang pertama. Sisanya boleh dilewati: paket yang
     * fisiknya sudah di tangan tidak boleh tertahan oleh label yang memang
     * tidak mencetak informasinya.
     */
    private static final String[][] TAHAP = {
        {"Nomor Pesanan", "Dekatkan kamera ke nomor pesanan (Order ID / No. Pesanan)", "wajib"},
        {"Toko & Marketplace", "Arahkan ke nama toko pengirim dan logo marketplace", "opsional"},
        {"Kurir & Layanan", "Arahkan ke nama kurir dan jenis layanannya", "opsional"},
        {"Daftar Produk", "Arahkan ke daftar produk beserta jumlahnya", "opsional"},
    };

    private View guide;
    private TextView guideStep, guideTitle, guideHint, guideFound;
    private MaterialButton guideSkip, guideNext;

    private boolean panduanAktif = false;
    private int tahap = 0;
    private String panduanResi, panduanRaw, panduanFormat;
    private final List<String> fotoTahap = new ArrayList<>();
    /**
     * Foto utama paket ini adalah gambar gabungan, bukan bidikan pertama.
     *
     * Menentukan bidikan mana yang masih perlu dikirim sebagai halaman: kalau
     * yang utama sudah gabungan, bidikan PERTAMA pun belum terkirim -- dan
     * bidikan pertama itu justru close-up nomor pesanan, yang paling berharga
     * saat gambarnya diperbesar.
     */
    private boolean gabunganDipakai = false;
    /** Order id yang akan dikirim. Tanpa ini, paket tidak bisa disimpan. */
    private String orderIdFinal = null;
    /** "ocr" atau "manual" — menentukan aturan mana yang dipakai server. */
    private String orderIdSumber = null;
    /** One text recognition at a time; they take longer than a frame. */
    private volatile boolean readingText = false;
    /** The pending hide for the banner on screen, so only it gets cancelled. */
    private Runnable hideBanner = null;
    private String mutedResi = null;
    private long mutedUntil = 0;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        session = new Session(this);
        api = new Api(session);
        if (!session.loggedIn()) {
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_scan);
        preview = findViewById(R.id.preview);
        status = findViewById(R.id.detected);
        detail = findViewById(R.id.courier);
        counter = findViewById(R.id.counter);
        hint = findViewById(R.id.hint);
        findViewById(R.id.menu).setOnClickListener(v -> showMenu());
        findViewById(R.id.torch).setOnClickListener(v -> toggleTorch());
        clarityBar = findViewById(R.id.clarityBar);
        clarityText = findViewById(R.id.clarityText);
        liveRead = findViewById(R.id.liveRead);

        textRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        loadCatalogue();
        loadMappingOptions();
        loadOcrMemory();
        // Versi diperiksa di sini, bukan di layar login: HP gudang tetap
        // masuk berhari-hari, jadi pemeriksaan yang menempel di login
        // sungguhan nyaris tidak pernah jalan. Sekali per aplikasi dibuka.
        UpdateActivity.periksaSekali(this, api);
        // Siapa yang masuk dan boleh apa. Dipakai hanya untuk menyembunyikan
        // menu yang pasti tertutup -- yang menegakkan aturannya tetap server.
        Access.muat(api);
        banner = findViewById(R.id.banner);
        bannerText = findViewById(R.id.bannerText);

        guide = findViewById(R.id.guide);
        guideStep = findViewById(R.id.guideStep);
        guideTitle = findViewById(R.id.guideTitle);
        guideHint = findViewById(R.id.guideHint);
        guideFound = findViewById(R.id.guideFound);
        guideSkip = findViewById(R.id.guideSkip);
        guideNext = findViewById(R.id.guideNext);
        guideNext.setOnClickListener(v -> potretTahap());
        guideSkip.setOnClickListener(v -> lewatiTahap());

        findViewById(R.id.manual).setOnClickListener(v -> promptManual());

        // Re-booked on every launch, not only when the setting changes. A
        // reboot, a force-stop or a cleared task can lose the pending work,
        // and enqueueUniqueWork with REPLACE makes doing it again harmless.
        // Registered once, from the screen that owns the session. Any request
        // on any screen that comes back unauthorised lands here.
        Api.onUnauthorised(() -> {
            if (isFinishing() || isDestroyed()) return;
            Toast.makeText(this, "Sesi berakhir. Silakan masuk lagi.", Toast.LENGTH_LONG).show();
            session.clear();
            Intent i = new Intent(this, LoginActivity.class);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            startActivity(i);
            finish();
        });

        StockReminder.ensureChannel(this);
        StockReminder.schedule(this);
        askNotificationPermission();

        // CODE_128 and CODE_39 only.
        //
        // The wider set was a mistake, and the first ten real scans showed it
        // cleanly: every CODE_128 read came back as a genuine waybill
        // (JY1289933656, CM90266206973), while every EAN_13 or ITF read came
        // back as a bare 12-13 digit number matching nothing on the label -
        // spurious decodes off the moire of a screen, and off retail barcodes
        // that happen to be in shot. Five of ten scans recorded a resi that
        // does not exist, and because the server refuses duplicates each one
        // permanently occupies a key the real parcel may later need. A missed
        // scan is retried in a second; a wrong one is silent and lasting.
        scanner = BarcodeScanning.getClient(new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39)
                .build());
        cameraExecutor = Executors.newSingleThreadExecutor();

        idle();
        refreshCounter();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        }
    }

    @Override public void onRequestPermissionsResult(int req, @NonNull String[] perms, @NonNull int[] granted) {
        super.onRequestPermissionsResult(req, perms, granted);
        if (req != REQ_CAMERA) return;
        if (granted.length > 0 && granted[0] == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            hint.setText("Izin kamera ditolak. Nomor resi masih bisa dimasukkan lewat Input Manual.");
        }
    }

    /**
     * The seller's products, so a marketing title on a label can be named.
     *
     * Failure is silent and harmless: with no catalogue the scanner still reads
     * the order number and still records the parcel, it just cannot say which
     * product the label describes. That is the same place the app was before.
     */
    private void loadCatalogue() {
        api.products(r -> {
            if (!r.ok() || r.body == null) return;
            JSONArray arr = r.body.optJSONArray("data");
            if (arr == null) return;
            List<ProductMatcher.Product> next = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String id = o.optString("id", "");
                if (id.isEmpty()) continue;
                next.add(new ProductMatcher.Product(
                        id,
                        o.optString("name", ""),
                        o.optString("sku", ""),
                        o.optString("marketplaceAliases", "")));
            }
            catalogue.clear();
            catalogue.addAll(next);
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
                dimForTheLabel();
            } catch (Exception e) {
                hint.setText("Kamera tidak bisa dibuka: " + e.getMessage());
            }
        }, ContextCompat.getMainExecutor(this));
    }

    /**
     * Bias the exposure down.
     *
     * A shipping label is a sheet of white paper, usually the brightest thing
     * in a dim warehouse or on a dark desk. Metering the whole scene therefore
     * over-exposes the one part that matters, and on the first real scans the
     * label came back as a blank white rectangle with the print burned away.
     * Under-exposing costs nothing here - the paper stays legible - and it
     * keeps the ink from being clipped into the paper.
     */
    private void dimForTheLabel() {
        try {
            if (camera == null) return;
            ExposureState state = camera.getCameraInfo().getExposureState();
            if (!state.isExposureCompensationSupported()) return;
            double step = state.getExposureCompensationStep().doubleValue();
            if (step <= 0) return;
            int index = (int) Math.round(EXPOSURE_EV / step);
            Range<Integer> range = state.getExposureCompensationRange();
            index = Math.max(range.getLower(), Math.min(range.getUpper(), index));
            camera.getCameraControl().setExposureCompensationIndex(index);
        } catch (Exception ignored) {
            // Not every device supports it; the photo is still usable without.
        }
    }

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

        // Measured even while a capture is pending. The gate below waits for
        // this number to come up, so it has to keep moving after the barcode
        // is found -- which is exactly when the packer is steadying their hand.
        long now = android.os.SystemClock.uptimeMillis();
        if (now - clarityAt >= CLARITY_INTERVAL_MS) {
            clarityAt = now;
            clarity = measureClarity(media);
            main.post(this::renderClarity);
        }

        // Rotation is needed by BOTH passes now, so it is worked out before
        // either of them rather than on the way into the barcode path.
        int rot = proxy.getImageInfo().getRotationDegrees();

        // While the shutter waits, spend the frames on reading the label. This
        // is the window the whole design turns on: the packer is holding still
        // for the photo anyway, and every frame that passes is another vote.
        if (busy) {
            if (collecting && !readingText) {
                readingText = true;
                textRecognizer.process(InputImage.fromMediaImage(media, rot))
                        .addOnSuccessListener(t -> {
                            reader.addFrame(t.getText());
                            suara.catat(t.getText());
                            main.post(this::renderLive);
                        })
                        .addOnCompleteListener(t -> {
                            readingText = false;
                            proxy.close();
                        });
            } else {
                proxy.close();
            }
            return;
        }
        // Menganggur terlalu lama tanpa barcode: sebagian kecil frame
        // dialihkan untuk membaca tulisannya. Satu frame tiap setengah detik
        // tidak terasa pada pemindaian barcode, dan itulah satu-satunya jalan
        // bagi label yang barcode-nya terlipat atau tertutup lakban.
        if (menganggurSejak > 0 && !readingText && !tawaranResiDitolak
                && now - menganggurSejak >= MULAI_BACA_TULISAN_MS
                && now - teksMenganggurAt >= JEDA_TULISAN_MS) {
            teksMenganggurAt = now;
            readingText = true;
            textRecognizer.process(InputImage.fromMediaImage(media, rot))
                    .addOnSuccessListener(t -> {
                        String teks = t.getText();
                        main.post(() -> kumpulkanResiTulisan(teks));
                    })
                    .addOnCompleteListener(t -> {
                        readingText = false;
                        proxy.close();
                    });
            return;
        }

        analysing = true;
        // ML Kit reports boxes in the UPRIGHT frame, so at 90/270 the sides swap.
        boolean swapped = rot == 90 || rot == 270;
        frameWidth = swapped ? proxy.getHeight() : proxy.getWidth();
        frameHeight = swapped ? proxy.getWidth() : proxy.getHeight();

        InputImage image = InputImage.fromMediaImage(media, rot);
        scanner.process(image)
                .addOnSuccessListener(codes -> main.post(() -> onBarcodes(codes)))
                .addOnCompleteListener(t -> {
                    analysing = false;
                    proxy.close();
                });
    }

    /**
     * Sharpness of the middle of the frame, as a percentage.
     *
     * Variance of the Laplacian: a focused edge swings hard between
     * neighbouring pixels and a blurred one does not, so the spread of that
     * difference is a direct measure of focus. Read straight off the Y plane,
     * which is already luminance, and subsampled to a fixed grid so the cost
     * does not change with the camera's resolution.
     *
     * The centre only. The packer aims the label at the middle of the screen,
     * and measuring the whole frame would average their hand and the floor into
     * the reading. Sensor orientation is not corrected because a centred box
     * stays centred however the frame is rotated.
     */
    private int measureClarity(android.media.Image img) {
        try {
            android.media.Image.Plane plane = img.getPlanes()[0];
            java.nio.ByteBuffer buf = plane.getBuffer();
            int rowStride = plane.getRowStride();
            int pixStride = plane.getPixelStride();
            int w = img.getWidth();
            int h = img.getHeight();

            int marginX = Math.round(w * (1f - CLARITY_REGION) / 2f);
            int marginY = Math.round(h * (1f - CLARITY_REGION) / 2f);
            int x0 = marginX, x1 = w - marginX;
            int y0 = marginY, y1 = h - marginY;

            int stepX = Math.max(1, (x1 - x0) / CLARITY_SAMPLES);
            int stepY = Math.max(1, (y1 - y0) / CLARITY_SAMPLES);

            double sum = 0, sumSq = 0;
            int n = 0;
            for (int y = y0 + stepY; y < y1 - stepY; y += stepY) {
                for (int x = x0 + stepX; x < x1 - stepX; x += stepX) {
                    int c = luma(buf, rowStride, pixStride, x, y);
                    int lap = 4 * c
                            - luma(buf, rowStride, pixStride, x - stepX, y)
                            - luma(buf, rowStride, pixStride, x + stepX, y)
                            - luma(buf, rowStride, pixStride, x, y - stepY)
                            - luma(buf, rowStride, pixStride, x, y + stepY);
                    sum += lap;
                    sumSq += (double) lap * lap;
                    n++;
                }
            }
            if (n < 32) return 0;
            double mean = sum / n;
            double variance = Math.max(0, sumSq / n - mean * mean);
            // Saturating rather than linear: variance has no ceiling, and a
            // percentage that keeps climbing past "sharp enough" would mean
            // nothing to the person reading it.
            return (int) Math.round(100.0 * variance / (variance + CLARITY_HALF));
        } catch (Exception e) {
            // A meter that throws must not stop the scanner. Zero reads as
            // "unknown", and the wait below falls through on its timeout.
            return 0;
        }
    }

    private static int luma(java.nio.ByteBuffer buf, int rowStride, int pixStride, int x, int y) {
        return buf.get(y * rowStride + x * pixStride) & 0xFF;
    }

    private void renderClarity() {
        if (clarityBar == null) return;
        int value = clarity;
        clarityBar.setProgress(value);
        boolean enough = value >= CLARITY_MIN;
        clarityText.setText("Kejelasan " + value + "% " + (enough ? "· cukup" : "· kurang"));
        clarityText.setTextColor(Color.parseColor(enough ? "#1B7F4B" : "#B3261E"));
    }

    private void onBarcodes(List<Barcode> codes) {
        if (busy || codes == null || codes.isEmpty()) return;

        // With several parcels in shot the camera sees several barcodes, and
        // taking whichever came first recorded the wrong one - that already
        // happened on a real scan. The packer aims at the parcel they mean, so
        // the barcode nearest the middle of the frame is the intended one.
        Barcode best = null;
        double bestDistance = Double.MAX_VALUE;
        Barcode kodePesanan = null;
        double jarakPesanan = Double.MAX_VALUE;
        for (Barcode code : codes) {
            String raw = code.getRawValue();
            if (raw == null) continue;
            String resi = ResiExtractor.normalize(raw);
            // A barcode is exact, but labels also carry codes for other things
            // (postal routing, a URL in a QR). Length is the cheap filter.
            if (resi.length() < 8 || resi.length() > 32) continue;

            Rect box = code.getBoundingBox();
            double d = 0;
            if (box != null && frameWidth > 0) {
                double dx = box.exactCenterX() / frameWidth - 0.5;
                double dy = box.exactCenterY() / frameHeight - 0.5;
                d = dx * dx + dy * dy;
            }

            // Label Shopee mencetak barcode NOMOR PESANAN di tengah lembar dan
            // barcode resi di atasnya. Karena yang dipilih adalah yang
            // terdekat ke tengah bingkai, membidik label justru memilih nomor
            // pesanan sebagai resi -- terukur: 9 scan menyimpan untaian
            // seperti "260814B62PDTY8" dan "585527219881477623" di kolom resi,
            // dan nomor pengiriman paket-paket itu tidak pernah tercatat.
            if (bentukNomorPesanan(resi)) {
                if (d < jarakPesanan) { jarakPesanan = d; kodePesanan = code; }
                continue;
            }
            if (d < bestDistance) {
                bestDistance = d;
                best = code;
            }
        }
        if (best == null) {
            // Yang terbaca hanya barcode nomor pesanan. Ia BUKAN resi, jadi
            // paketnya belum boleh dimulai -- biarkan bingkai berikutnya, atau
            // cadangan pembacaan dari tulisan, yang menemukan resinya.
            if (kodePesanan != null) {
                pesananDariBarcode = ResiExtractor.normalize(kodePesanan.getRawValue());
            }
            return;
        }
        if (kodePesanan != null) {
            pesananDariBarcode = ResiExtractor.normalize(kodePesanan.getRawValue());
        }

        // The other codes printed on the same label. Kept only when they sit
        // close to the winner: see SAME_LABEL_RADIUS.
        Rect bestBox = best.getBoundingBox();
        for (Barcode code : codes) {
            String raw = code.getRawValue();
            if (raw == null) continue;
            String other = ResiExtractor.normalize(raw);
            if (other.length() < 10 || other.length() > 32) continue;
            if (bestBox != null && frameWidth > 0) {
                Rect b = code.getBoundingBox();
                if (b == null) continue;
                double dx = (b.exactCenterX() - bestBox.exactCenterX()) / frameWidth;
                double dy = (b.exactCenterY() - bestBox.exactCenterY()) / frameHeight;
                if (Math.sqrt(dx * dx + dy * dy) > SAME_LABEL_RADIUS) continue;
            }
            if (seenCodes.size() < MAX_CODES_PER_LABEL) seenCodes.add(other);
        }

        String resi = ResiExtractor.normalize(best.getRawValue());
        if (resi.equals(mutedResi) && System.currentTimeMillis() < mutedUntil) return;

        Rect box = best.getBoundingBox();
        lastBarcodeBox = (box == null || frameWidth <= 0) ? null : new RectF(
                box.left / (float) frameWidth,
                box.top / (float) frameHeight,
                box.right / (float) frameWidth,
                box.bottom / (float) frameHeight);

        mute(resi);
        menganggurSejak = 0;
        resiTulisan.clear();
        reader.reset();
        // Suara paket sebelumnya yang terbawa akan memilih nomor
        // pesanan milik paket yang salah.
        suara.kosongkan();
        // SESUDAH dikosongkan, bukan sebelum. Ditulis sebelum, seluruh
        // catatannya terhapus beberapa baris kemudian dan jalur barcode itu
        // tidak pernah berpengaruh sama sekali.
        for (String c : seenCodes) suara.catatBarcode(c);
        if (pesananDariBarcode != null) {
            suara.catatBarcode(pesananDariBarcode);
            pesananDariBarcode = null;
        }
        collecting = true;
        focusThenCapture(resi, best.getRawValue(), formatName(best.getFormat()));
    }

    /**
     * Nudge autofocus onto the label before the shutter. The first real scans
     * came back soft enough that even a human had to squint, and a blurred
     * photo is unreadable no matter how many pixels it has.
     */
    private void focusThenCapture(String resi, String raw, String format) {
        busy = true;
        status.setText(resi);
        status.setTextColor(Color.parseColor("#1B1D1F"));
        detail.setVisibility(View.GONE);
        hint.setText("Fokus...");

        RectF box = lastBarcodeBox;
        if (camera == null || box == null) {
            capture(resi, raw, format);
            return;
        }
        try {
            MeteringPoint point = preview.getMeteringPointFactory()
                    .createPoint(box.centerX() * preview.getWidth(),
                                 box.centerY() * preview.getHeight());
            camera.getCameraControl().startFocusAndMetering(
                    new FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF)
                            .disableAutoCancel()
                            .build());
        } catch (Exception ignored) {
            // Focus is an improvement, not a requirement.
        }
        main.postDelayed(() -> mulaiPanduan(resi, raw, format), FOCUS_SETTLE_MS);
    }

    /* ══════════════════════════════════════════════ scan bertahap ══════ */

    /**
     * Mengumpulkan calon resi dari satu bingkai tulisan.
     *
     * Ambang skornya sengaja tinggi: yang lolos hanya yang berdampingan dengan
     * kata "Resi"/"AWB" atau berawalan kurir yang dikenal. Sebuah label penuh
     * angka -- nomor telepon pembeli, kode pos, nomor pesanan -- dan menawarkan
     * angka mana saja yang panjang akan membuat tawaran ini lebih sering salah
     * daripada benar, lalu berhenti dipercaya.
     */
    private void kumpulkanResiTulisan(String teks) {
        if (busy || tawaranResiDitolak || tawaranResiTampil) return;
        for (ResiExtractor.Candidate c : ResiExtractor.extract(teks)) {
            if (c.score < 40) continue;
            if (bentukNomorPesanan(c.value)) continue;
            Integer n = resiTulisan.get(c.value);
            resiTulisan.put(c.value, n == null ? 1 : n + 1);
        }
        String menang = null;
        int tertinggi = 0;
        for (java.util.Map.Entry<String, Integer> e : resiTulisan.entrySet()) {
            if (e.getValue() > tertinggi) { tertinggi = e.getValue(); menang = e.getKey(); }
        }
        if (menang == null || tertinggi < SUARA_RESI_MIN) return;
        tawarkanResiTulisan(menang, tertinggi);
    }

    /**
     * Menawarkan resi yang terbaca dari tulisan.
     *
     * Ditawarkan, tidak dipakai sendiri. Pembacaan tulisan tidak punya
     * checksum seperti barcode, dan resi yang salah lebih buruk daripada resi
     * yang kosong: server menolak duplikat, jadi nomor yang keliru membakar
     * kunci yang mungkin dibutuhkan paket yang benar nanti.
     */
    private void tawarkanResiTulisan(final String nilai, int suaraNya) {
        if (isFinishing() || isDestroyed() || busy || tawaranResiTampil) return;
        tawaranResiTampil = true;
        String kurir = ResiExtractor.courierOf(nilai);
        new MaterialAlertDialogBuilder(this)
                .setTitle("Resi terbaca dari tulisan")
                .setMessage(nilai + (kurir != null ? "\n\nKurir: " + kurir : "")
                        + "\n\nBarcode-nya tidak terbaca — mungkin terlipat atau "
                        + "tertutup. Nomor ini dibaca dari tulisan di label oleh "
                        + suaraNya + " bidikan. Cocok?")
                .setPositiveButton("Ya, pakai ini", (d, w) -> {
                    tawaranResiTampil = false;
                    menganggurSejak = 0;
                    resiTulisan.clear();
                    mute(nilai);
                    reader.reset();
                    suara.kosongkan();
                    collecting = true;
                    // Sumbernya "ocr", bukan "barcode": asal sebuah nomor
                    // menentukan seberapa ia layak dipercaya nanti saat audit.
                    focusThenCapture(nilai, nilai, "OCR");
                })
                .setNegativeButton("Bukan, terus cari", (d, w) -> {
                    tawaranResiTampil = false;
                    // Tidak ditawarkan lagi sampai paket berikutnya: menanyakan
                    // hal yang sama berulang-ulang membuat orang berhenti
                    // membacanya dan menekan apa saja.
                    tawaranResiDitolak = true;
                    resiTulisan.clear();
                })
                .setCancelable(false)
                .show();
    }

    private void mulaiPanduan(String resi, String raw, String format) {
        if (isFinishing() || isDestroyed()) return;
        panduanAktif = true;
        tahap = 0;
        fotoTahap.clear();
        orderIdFinal = null;
        orderIdSumber = null;
        panduanResi = resi;
        panduanRaw = raw;
        panduanFormat = format;
        // Frame terus dibaca sepanjang panduan: itulah yang membuat setiap
        // bidikan dekat menambah suara, bukan menggantikan yang sebelumnya.
        collecting = true;
        guide.setVisibility(View.VISIBLE);
        renderPanduan();
        main.postDelayed(this::detakPanduan, 250);
    }

    /** Menyegarkan panel dan memeriksa apakah tahap wajibnya sudah terpenuhi. */
    private void detakPanduan() {
        if (!panduanAktif || isFinishing() || isDestroyed()) return;
        if (tahap == 0 && orderIdFinal == null) {
            OrderId.Bacaan b = suara.hasil();
            // Hanya keyakinan tinggi yang diterima tanpa ditanya. Yang sedang
            // TIDAK dibuang -- ia ditawarkan di panel untuk dibenarkan sekali
            // sentuh, lihat renderPanduan().
            if (b != null && b.pasti()) {
                orderIdFinal = b.nilai;
                // Dibedakan supaya server tahu aturan mana yang berlaku:
                // yang berjangkar dinyatakan sendiri oleh labelnya.
                orderIdSumber = b.berjangkar ? "ocr_label" : "ocr";
                feedback(true);
            }
        }
        renderPanduan();
        main.postDelayed(this::detakPanduan, 250);
    }

    private void renderPanduan() {
        if (!panduanAktif || tahap >= TAHAP.length) return;
        String[] t = TAHAP[tahap];
        boolean wajib = "wajib".equals(t[2]);

        guideStep.setText("Langkah " + (tahap + 1) + " dari " + TAHAP.length
                + (wajib ? " · wajib" : ""));
        guideTitle.setText(t[0]);
        guideHint.setText(t[1]);

        if (tahap == 0) {
            boolean ada = orderIdFinal != null;
            OrderId.Bacaan b = ada ? null : suara.hasil();

            // Tiga keadaan, dan yang tengah itulah yang dulu tidak ada.
            // "Belum terbaca" sementara aplikasi yang sama menampilkan
            // nomornya beberapa sentimeter di bawah adalah cara tercepat
            // membuat orang berhenti percaya pada layarnya.
            if (ada) {
                guideFound.setText("✓ " + orderIdFinal);
                guideFound.setTextColor(Color.parseColor("#7BD88F"));
                guideNext.setEnabled(true);
                guideNext.setText("Lanjut");
            } else if (b != null) {
                guideFound.setText("Terbaca \"" + b.nilai + "\" — "
                        + Math.round(b.skor * 100) + "% yakin (" + b.alasan + ")");
                guideFound.setTextColor(Color.parseColor("#F2A93B"));
                // Satu ketukan untuk membenarkan. Menyuruh orang mengetik
                // ulang nomor yang sudah terbaca di layarnya adalah cara
                // membuat jalan keluar ini tidak pernah dipakai.
                guideNext.setEnabled(true);
                guideNext.setText("Pakai " + b.nilai);
            } else {
                guideFound.setText("Belum terbaca — " + suara.frame()
                        + " frame, kejelasan " + clarity + "%");
                guideFound.setTextColor(Color.parseColor("#F2A93B"));
                guideNext.setEnabled(false);
                guideNext.setText("Menunggu nomor pesanan");
            }
            // Tidak ada "Lewati" untuk yang wajib. Jalan keluarnya memilih
            // atau mengetik, yang tetap menghasilkan order id.
            guideSkip.setText(suara.pilihan().size() > 1 ? "Pilih nomor lain" : "Ketik manual");
        } else {
            guideFound.setText(reader.frames() + " frame terbaca");
            guideFound.setTextColor(Color.parseColor("#9AA0A6"));
            guideNext.setEnabled(true);
            guideNext.setText("Lanjut");
            guideSkip.setText("Lewati");
        }
    }

    private void lewatiTahap() {
        if (!panduanAktif) return;
        if (tahap == 0) {
            pilihOrderId();
            return;
        }
        majuTahap();
    }

    /**
     * Menawarkan nomor-nomor yang terbaca untuk disentuh.
     *
     * Menyentuh tidak bisa salah ketik, dan yang benar hampir selalu ada di
     * antara tiga teratas -- label yang sama sudah dibaca ratusan kali. Kotak
     * ketik tetap ada sebagai pilihan terakhir, bukan sebagai satu-satunya.
     */
    private void pilihOrderId() {
        final java.util.List<OrderId.Bacaan> pil = suara.pilihan();
        if (pil.isEmpty()) {
            ketikOrderId();
            return;
        }
        final String[] baris = new String[pil.size() + 1];
        for (int i = 0; i < pil.size(); i++) {
            OrderId.Bacaan b = pil.get(i);
            baris[i] = b.nilai + "   (" + Math.round(b.skor * 100) + "% yakin, "
                    + suara.suaraUntuk(b.nilai) + " frame)";
        }
        baris[pil.size()] = "Ketik manual…";

        new MaterialAlertDialogBuilder(this)
                .setTitle("Nomor pesanan yang terbaca")
                .setItems(baris, (d, which) -> {
                    if (which >= pil.size()) {
                        ketikOrderId();
                        return;
                    }
                    orderIdFinal = pil.get(which).nilai;
                    orderIdSumber = "ocr_confirmed";
                    feedback(true);
                    renderPanduan();
                })
                .setNegativeButton("Batal", null)
                .show();
    }

    /**
     * Jalan keluar untuk label yang nomor pesanannya memang tidak terbaca.
     *
     * Mengetik adalah tindakan sadar dengan label di tangan, jadi bentuk
     * Shopee yang alfanumerik diterima di sini sementara jalur OCR tetap
     * menolaknya. Tanpa jalan keluar ini, satu label buram akan menahan paket
     * yang fisiknya sudah siap berangkat.
     */
    private void ketikOrderId() {
        final EditText input = new EditText(this);
        input.setHint("Nomor pesanan seperti tertulis di label");
        // Diisi kandidat yang sudah dibaca, kalau ada. Menyuruh orang mengetik
        // ulang empat belas karakter yang sudah terbaca di layar adalah cara
        // membuat jalan keluar ini tidak pernah dipakai.
        OrderId.Bacaan terkuat = suara.hasil();
        String awal = terkuat != null ? terkuat.nilai : reader.orderNo();
        if (awal != null) {
            input.setText(awal);
            input.setSelection(awal.length());
        }
        input.setInputType(InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        androidx.appcompat.app.AlertDialog d = new MaterialAlertDialogBuilder(this)
                .setTitle("Ketik nomor pesanan")
                .setMessage("Nomor pesanan wajib ada supaya paket ini bisa dicocokkan "
                        + "dengan laporan marketplace nanti.")
                .setView(input)
                .setPositiveButton("Simpan", null)
                .setNegativeButton("Batal", null)
                .create();
        d.setOnShowListener(dd -> d.getButton(android.app.AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(v -> {
                    String v2 = OrderId.dariKetikan(input.getText().toString());
                    if (v2 == null) {
                        Toast.makeText(this,
                                "Itu bukan nomor pesanan — bentuknya nomor pengiriman "
                                        + "kurir, nomor telepon, atau terlalu pendek.",
                                Toast.LENGTH_LONG).show();
                        return;
                    }
                    orderIdFinal = v2;
                    orderIdSumber = "manual";
                    // Kotak isian sudah menampilkan kandidat OCR, jadi yang
                    // diketik biasanya tinggal koreksi satu-dua huruf.
                    d.dismiss();
                    renderPanduan();
                }));
        d.show();
    }

    /** Memotret tahap ini, lalu maju. */
    private void potretTahap() {
        if (!panduanAktif) return;
        if (tahap == 0 && orderIdFinal == null) {
            // Tombolnya berbunyi "Pakai <nomor>", jadi menekannya ADALAH
            // pembenaran -- tindakan sadar oleh orang yang memegang labelnya,
            // dan itulah yang membuat nilai keyakinan sedang boleh dipakai.
            OrderId.Bacaan b = suara.hasil();
            if (b == null) return;
            orderIdFinal = b.nilai;
            orderIdSumber = "ocr_confirmed";
            feedback(true);
        }
        guideNext.setEnabled(false);
        guideNext.setText("Memotret...");
        if (imageCapture == null) {
            majuTahap();
            return;
        }
        imageCapture.takePicture(cameraExecutor, new ImageCapture.OnImageCapturedCallback() {
            @Override public void onCaptureSuccess(@NonNull ImageProxy image) {
                String b64 = null;
                try {
                    b64 = toBase64Jpeg(image);
                } catch (Throwable ignored) {
                    // Foto itu bukti tambahan, bukan syarat. Kegagalan encode
                    // tidak boleh menghilangkan paket yang benar-benar discan.
                } finally {
                    image.close();
                }
                final String p = b64;
                main.post(() -> {
                    if (p != null) fotoTahap.add(p);
                    majuTahap();
                });
            }

            @Override public void onError(@NonNull ImageCaptureException e) {
                main.post(() -> majuTahap());
            }
        });
    }

    private void majuTahap() {
        tahap += 1;
        if (tahap < TAHAP.length) {
            renderPanduan();
            return;
        }
        selesaiPanduan();
    }

    private void selesaiPanduan() {
        panduanAktif = false;
        collecting = false;
        busy = true;
        guide.setVisibility(View.GONE);
        gabunganDipakai = false;

        final List<String> bidikan = new ArrayList<>(fotoTahap);
        if (bidikan.size() <= 1) {
            hint.setText("Membaca hasil...");
            resolve(panduanResi, panduanRaw, panduanFormat,
                    bidikan.isEmpty() ? null : bidikan.get(0));
            return;
        }

        // Penyusunannya memuat dan mengecilkan beberapa bitmap besar. Di utas
        // utama itu berarti layar membeku beberapa detik tepat saat paket
        // berpindah tangan ke kurir.
        hint.setText("Menyusun gambar...");
        final String[] nama = new String[TAHAP.length];
        for (int i = 0; i < TAHAP.length; i++) nama[i] = TAHAP[i][0];
        cameraExecutor.execute(() -> {
            final String gabungan = GabungFrame.rakit(bidikan, nama, PHOTO_QUALITY);
            main.post(() -> {
                gabunganDipakai = gabungan != null;
                hint.setText("Membaca hasil...");
                // Gagal menyusun tidak boleh menahan paketnya: kembali ke
                // bidikan pertama, persis seperti sebelum fitur ini ada.
                resolve(panduanResi, panduanRaw, panduanFormat,
                        gabungan != null ? gabungan : bidikan.get(0));
            });
        });
    }

    /**
     * Bidikan tahap kedua dan seterusnya, dikirim setelah scan-nya ada.
     *
     * Lewat endpoint halaman yang memang sudah ada untuk resi yang tercetak di
     * beberapa lembar — pertanyaannya sama: satu waybill, beberapa gambar.
     */
    private void kirimFotoSisa(String scanId) {
        if (scanId == null || scanId.isEmpty()) return;
        // Kalau yang utama gambar gabungan, TIDAK ADA bidikan asli yang sudah
        // terkirim -- termasuk yang pertama. Menggabungkan mengecilkan tiap
        // bidikan supaya muat satu bingkai; yang ingin memperbesar sampai ke
        // serat kertasnya membuka bidikan aslinya, dan itu harus ada.
        final int mulai = gabunganDipakai ? 0 : 1;
        if (fotoTahap.size() <= mulai) return;
        final List<String> sisa = new ArrayList<>(fotoTahap.subList(mulai, fotoTahap.size()));
        fotoTahap.clear();
        for (String f : sisa) {
            api.addPage(scanId, f, null, r -> {
                // Diam-diam saja kalau gagal: bidikan tambahan memperkaya
                // buktinya, dan kegagalannya tidak mengubah apa pun yang sudah
                // tersimpan.
            });
        }
    }

    /**
     * Hold the shutter until the picture is sharp enough to be worth reading.
     *
     * Polls rather than blocks: the analyser is still running and updating the
     * meter, so this only has to notice when the number comes up. The wait is
     * capped -- see CLARITY_WAIT_MS -- because the waybill is already known and
     * losing the scan would cost more than a soft photograph does.
     */
    private void waitForClarity(String resi, String raw, String format, long startedAt) {
        if (isFinishing() || isDestroyed()) return;

        long elapsed = android.os.SystemClock.uptimeMillis() - startedAt;
        boolean readEnough = elapsed >= READ_MIN_MS || reader.frames() >= READ_MIN_FRAMES;

        if (clarity >= CLARITY_MIN && readEnough) {
            tookBlurred = false;
            capture(resi, raw, format);
            return;
        }
        if (elapsed >= CLARITY_WAIT_MS) {
            tookBlurred = clarity < CLARITY_MIN;
            capture(resi, raw, format);
            return;
        }
        hint.setText(clarity >= CLARITY_MIN
                ? "Membaca label... " + reader.frames() + " frame"
                : "Tahan agak diam - kejelasan " + clarity + "%, perlu " + CLARITY_MIN + "%");
        main.postDelayed(() -> waitForClarity(resi, raw, format, startedAt), 100);
    }

    /** Takes the still, then submits. The photo is what the server will read. */
    private void capture(String resi, String raw, String format) {
        busy = true;
        hint.setText("Memotret label...");

        collecting = false;
        if (imageCapture == null) {
            resolve(resi, raw, format, null);
            return;
        }

        imageCapture.takePicture(cameraExecutor, new ImageCapture.OnImageCapturedCallback() {
            @Override public void onCaptureSuccess(@NonNull ImageProxy image) {
                String b64 = null;
                try {
                    b64 = toBase64Jpeg(image);
                } catch (Throwable t) {
                    // A photo is a nice-to-have; the scan is not. Never let an
                    // encoding failure lose a parcel that was really scanned.
                } finally {
                    image.close();
                }
                final String payload = b64;
                main.post(() -> resolve(resi, raw, format, payload));
            }

            @Override public void onError(@NonNull ImageCaptureException e) {
                main.post(() -> resolve(resi, raw, format, null));
            }
        });
    }

    /**
     * Rotate upright, crop to the label, then flatten to high-contrast grey.
     *
     * Order matters: rotating first puts the still in the same upright space
     * ML Kit reported the barcode in, so the recorded fractions map straight
     * across. Cropping before the size cap is the whole point - it spends the
     * pixel budget on the label instead of on the cardboard around it.
     */
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

        Bitmap cropped = cropToLabel(bmp, lastBarcodeBox);
        if (cropped != bmp) bmp.recycle();
        bmp = cropped;

        int w = bmp.getWidth(), h = bmp.getHeight();
        int longest = Math.max(w, h);
        if (longest > PHOTO_MAX_EDGE) {
            float s = (float) PHOTO_MAX_EDGE / longest;
            Bitmap scaled = Bitmap.createScaledBitmap(bmp, Math.round(w * s), Math.round(h * s), true);
            if (scaled != bmp) bmp.recycle();
            bmp = scaled;
        }

        Bitmap grey = toGrey(bmp);
        if (grey != bmp) bmp.recycle();
        bmp = grey;

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, PHOTO_QUALITY, out);
        bmp.recycle();
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    /** Expand the barcode's box out to the label around it. */
    private static Bitmap cropToLabel(Bitmap src, RectF box) {
        if (box == null) return src;
        int w = src.getWidth(), h = src.getHeight();

        float bw = box.width() * w;
        float bh = box.height() * h;
        if (bw <= 0 || bh <= 0) return src;

        float cx = box.centerX() * w;
        float cy = box.centerY() * h;

        int left = Math.max(0, Math.round(cx - bw * (0.5f + CROP_SIDE)));
        int right = Math.min(w, Math.round(cx + bw * (0.5f + CROP_SIDE)));
        int top = Math.max(0, Math.round(cy - bh * CROP_ABOVE));
        int bottom = Math.min(h, Math.round(cy + bh * CROP_BELOW));

        // If the maths collapses, keep the whole frame rather than a sliver.
        if (right - left < w / 8 || bottom - top < h / 8) return src;
        return Bitmap.createBitmap(src, left, top, right - left, bottom - top);
    }

    /**
     * Plain greyscale. No contrast stretch - that was actively harmful.
     *
     * The previous build multiplied contrast by 2.2 around a fixed mid-grey.
     * On these photos, where the white label is already near the top of the
     * range, that pushed roughly a quarter of every image to pure white and
     * another quarter to pure black. Thin strokes live in the mid-tones, so
     * the small print - recipient, order number, the product table - dissolved
     * entirely while only the large bold text survived. Measured on the real
     * scans: 25-30% of pixels clipped at each end, mid-tones down to a fifth
     * of the image, and OCR scoring zero. Clipping is not recoverable, so no
     * amount of later processing brought it back.
     *
     * Greyscale alone is kept because it roughly halves the upload without
     * discarding anything: tesseract works on luminance and does its own
     * adaptive thresholding, which is better than a fixed stretch precisely
     * because it adapts to each image.
     */
    private static Bitmap toGrey(Bitmap src) {
        Bitmap out = Bitmap.createBitmap(src.getWidth(), src.getHeight(), Bitmap.Config.ARGB_8888);
        ColorMatrix grey = new ColorMatrix();
        grey.setSaturation(0f);
        Paint paint = new Paint();
        paint.setColorFilter(new ColorMatrixColorFilter(grey));
        new Canvas(out).drawBitmap(src, 0, 0, paint);
        return out;
    }

    /** One product line the label appears to carry, and what it might be. */
    /**
     * Shown on a row whose product was picked with nothing to go on.
     *
     * Carried in rawText, which the sheet already prints under "Di resi:", so
     * the caveat lands exactly where the packer is looking when they decide.
     */
    private static final String UNSURE = "belum yakin - pastikan produknya";

    private static final class Candidate {
        /** What the label said, or null when the packer added the line. */
        final String rawText;
        final List<ProductMatcher.Match> ranked;
        /** Index into ranked, or -1 for "not one of my products". */
        int chosen = 0;
        double qty = 1;
        EditText qtyField;
        /** True when the packer picked the product rather than the phone. */
        boolean manual = false;

        Candidate(String rawText, List<ProductMatcher.Match> ranked) {
            this.rawText = rawText;
            this.ranked = ranked;
        }
    }

    /**
     * Turn what was read into products, asking the packer only where the
     * reading cannot settle it.
     *
     * The asking threshold is the whole safety argument. This catalogue holds
     * "Cool Mint 100ml" beside "Cool Mint Spray 50ml" and "Refill Anti Ngantuk"
     * beside "Inhaler Anti Ngantuk" — pairs that differ in exactly the
     * characters OCR gets wrong. A confident-looking wrong product is worse
     * than an empty line, because nobody re-checks a filled-in field.
     */
    /** One window of consecutive label lines, and what it might be. */
    private static final class Window {
        final double score;
        final int start;
        final int len;
        final String text;
        final List<ProductMatcher.Match> ranked;

        Window(double score, int start, int len, String text, List<ProductMatcher.Match> ranked) {
            this.score = score;
            this.start = start;
            this.len = len;
            this.text = text;
            this.ranked = ranked;
        }
    }

    /**
     * Match the label's product lines, trying neighbours together.
     *
     * A product name is routinely split across consecutive lines. Scored one at
     * a time, "Perghilang Bau" and "Kaki Cooling Foot Spray" are two weak
     * fragments that match nothing; joined, they are a product. So every window
     * of up to MERGE_MAX consecutive lines is scored, and the best-scoring
     * windows are taken greedily as long as they do not overlap — one line
     * belongs to one product.
     */
    private List<Candidate> buildCandidates(List<LabelReader.Line> lines) {
        List<Window> windows = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            StringBuilder joined = new StringBuilder();
            for (int len = 1; len <= MERGE_MAX && i + len <= lines.size(); len++) {
                if (len > 1) joined.append(' ');
                joined.append(lines.get(i + len - 1).text);
                String text = joined.toString();
                List<ProductMatcher.Match> ranked = ProductMatcher.rank(text, catalogue, 5);
                if (ranked.isEmpty()) continue;
                windows.add(new Window(ranked.get(0).score, i, len, text, ranked));
            }
        }
        Collections.sort(windows, (a, b) -> Double.compare(b.score, a.score));

        boolean[] taken = new boolean[lines.size()];
        List<Candidate> out = new ArrayList<>();
        for (Window w : windows) {
            boolean clash = false;
            for (int k = w.start; k < w.start + w.len; k++) if (taken[k]) clash = true;
            if (clash) continue;
            for (int k = w.start; k < w.start + w.len; k++) taken[k] = true;
            out.add(new Candidate(w.text, w.ranked));
            if (out.size() >= MAX_ITEMS_PER_SCAN) break;
        }
        return out;
    }

    private void resolve(String resi, String raw, String format, String photoBase64) {
        collecting = false;
        List<LabelReader.Line> lines = reader.productLines();
        List<Candidate> candidates = buildCandidates(lines);

        // Pencarian SELURUH teks, dijalankan di setiap scan.
        //
        // Diukur pada 284 scan yang itemnya dikonfirmasi manusia: pencocokan
        // per baris menghasilkan tebakan pada 31% scan dan tebakan teratasnya
        // tepat 18%; pencarian seluruh teks menghasilkan tebakan pada 73% dan
        // tepat 49%. Sebabnya terlihat di rawName yang tersimpan -- alamat dan
        // nama produk menyatu dalam satu baris, karena OCR memotong baris
        // menurut tata letak cetakan, bukan menurut arti.
        List<ProductMatcher.Match> dariTeks =
                ProductMatcher.cariDiTeks(reader.rawText(), catalogue, 5);

        if (candidates.isEmpty()) {
            // Satu baris berisi seluruh urutan kemungkinan, bukan satu baris
            // per produk yang cocok: dua produk yang sama-sama tinggi hampir
            // selalu dua tafsir atas SATU barang, bukan dua barang.
            if (!dariTeks.isEmpty()) {
                candidates = new ArrayList<>();
                candidates.add(new Candidate(UNSURE, dariTeks));
            } else {
                candidates = guessFromRawText();
            }
        } else {
            perkayaPilihan(candidates, dariTeks);
        }

        // Confirmed on EVERY scan, however sure the phone is.
        //
        // It used to skip the sheet when every line matched confidently, on the
        // grounds that a tap per parcel is expensive. In practice a confident
        // match is not the same as a correct one — this catalogue holds pairs
        // that differ by one character OCR routinely drops — and a wrong
        // product recorded silently is found weeks later in a sales report, if
        // at all. The best match is pre-selected, so agreeing is one tap.
        //
        // The exception is having nothing to confirm against: with no product
        // list loaded the sheet would offer an empty dropdown, which asks the
        // packer to solve a problem that is not theirs.
        if (catalogue.isEmpty()) {
            hint.setText("Master produk belum termuat - isi paket dilewati.");
            submit(resi, raw, format, photoBase64, reading(candidates, false));
            return;
        }
        ask(resi, raw, format, photoBase64, candidates);
    }

    /**
     * Products whose names appear in what the camera read.
     *
     * A product is proposed when every word of its name at least three letters
     * long is somewhere in the text. Strict on purpose: this runs only when
     * clustering found nothing, so its competition is an empty sheet, and a
     * list of maybes would be worse than that — the packer would have to read
     * and reject each one.
     *
     * The quantity is left at 1. The text rarely carries a count in a form
     * worth trusting, and a wrong number that looks deliberate is worse than
     * the number the packer would have typed anyway.
     */
    /**
     * Menambahkan hasil pencarian seluruh teks ke daftar pilihan tiap baris.
     *
     * Ditambahkan, bukan menggantikan. Baris yang terbentuk dari klaster
     * membawa kata-kata yang benar-benar berdampingan di label, dan itu bukti
     * yang tidak dimiliki pencarian seluruh teks. Yang dilakukan di sini hanya
     * memastikan produk yang benar ADA di dalam daftar pilihan, supaya
     * membetulkannya cukup satu ketukan alih-alih mencari sendiri di katalog.
     */
    private void perkayaPilihan(List<Candidate> candidates, List<ProductMatcher.Match> dariTeks) {
        if (dariTeks.isEmpty()) return;
        for (Candidate c : candidates) {
            for (ProductMatcher.Match m : dariTeks) {
                if (c.ranked.size() >= 5) break;
                boolean sudah = false;
                for (ProductMatcher.Match ada : c.ranked) {
                    if (ada.product.id.equals(m.product.id)) { sudah = true; break; }
                }
                if (!sudah) c.ranked.add(m);
            }
        }
    }

    private List<Candidate> guessFromRawText() {
        List<Candidate> out = new ArrayList<>();
        String text = reader.rawText();
        if (text == null || text.length() < 8 || catalogue.isEmpty()) return out;

        // Character-level, because whole words do not survive: a real capture
        // reads "Reralus Swak Spey Mih / 100ML" for "Mouthspray Siwak 100ml".
        // The matcher returns null rather than a best-of-a-bad-lot, so an
        // ambiguous label still opens the sheet empty rather than wrong.
        // What has been answered before, first. No score beats the packer
        // having already said what this reading means.
        ProductMatcher.Product remembered = recall(text);
        if (remembered != null) {
            List<ProductMatcher.Match> ranked = new ArrayList<>();
            ranked.add(ProductMatcher.pick(remembered));
            for (ProductMatcher.Product other : catalogue) {
                if (!other.id.equals(remembered.id)) ranked.add(ProductMatcher.pick(other));
            }
            Candidate c = new Candidate(text, ranked);
            c.chosen = 0;
            out.add(c);
            return out;
        }

        FuzzyMatch.Scored best = FuzzyMatch.best(text, catalogue);
        boolean sure = best != null;
        if (best == null) {
            // Asked for explicitly: a blank picker made the packer go looking
            // before they could start. The row is marked below so a weak guess
            // is not mistaken for a firm one.
            best = FuzzyMatch.closest(text, catalogue);
        }
        if (best == null) return out;

        List<ProductMatcher.Match> ranked = new ArrayList<>();
        ranked.add(ProductMatcher.pick(best.product));
        // The rest of the catalogue stays behind it: a proposal the packer
        // cannot move off is worse than no proposal.
        for (ProductMatcher.Product other : catalogue) {
            if (!other.id.equals(best.product.id)) ranked.add(ProductMatcher.pick(other));
        }
        // The reading itself travels as rawName, which is what makes the
        // packer's answer learnable. Sending the caveat instead, as an earlier
        // build did, threw away the only thing worth remembering.
        Candidate c = new Candidate(sure ? text : UNSURE + " | " + text, ranked);
        c.chosen = 0;
        out.add(c);
        return out;
    }

    /** The sheet shown when the phone will not guess on its own. */
    private void ask(String resi, String raw, String format, String photoBase64,
                     List<Candidate> candidates) {
        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        if (candidates.isEmpty()) {
            TextView none = new TextView(this);
            none.setText("Tidak ada produk yang dikenali dari resi ini. "
                    + "Tambahkan sendiri di bawah.");
            none.setTextSize(12);
            none.setPadding(0, 0, 0, (int) (8 * d));
            root.addView(none);
        }

        // Numbered, because a parcel with three products is the case this
        // sheet exists for and an unlabelled stack of dropdowns does not read
        // as a list of them.
        int n = 0;
        for (final Candidate c : candidates) {
            n++;
            final LinearLayout block = new LinearLayout(this);
            block.setOrientation(LinearLayout.VERTICAL);
            root.addView(block);

            LinearLayout head = new LinearLayout(this);
            head.setOrientation(LinearLayout.HORIZONTAL);

            TextView label = new TextView(this);
            String shown = c.rawText == null
                    ? "(ditambahkan manual)"
                    : (c.rawText.length() > 90 ? c.rawText.substring(0, 90) + "…" : c.rawText);
            boolean sure = !c.ranked.isEmpty() && c.ranked.get(0).confident;
            label.setText("Produk " + n + (sure ? "  ✓ cocok" : "  ? periksa") + "\nDi resi: " + shown);
            label.setTextSize(11);
            label.setTextColor(Color.parseColor(sure ? "#1B7F4B" : "#6B7178"));
            label.setPadding(0, (int) (10 * d), 0, (int) (2 * d));
            head.addView(label, new LinearLayout.LayoutParams(
                    0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            // The reader invents lines from shadows and from the courier's own
            // small print. Marking one "not mine" already dropped it, but it
            // left the row on screen looking like an entry, which on a parcel
            // with several of them buries the ones that are real.
            MaterialButton del = new MaterialButton(this, null,
                    com.google.android.material.R.attr.materialButtonOutlinedStyle);
            del.setText("Hapus");
            del.setAllCaps(false);
            del.setTextSize(11);
            del.setOnClickListener(v -> {
                c.chosen = -1;
                c.qtyField = null;
                root.removeView(block);
            });
            head.addView(del);
            block.addView(head);

            List<String> options = new ArrayList<>();
            for (ProductMatcher.Match m : c.ranked) {
                options.add(m.product.name + "  (" + Math.round(m.score * 100) + "%)");
            }
            options.add("— bukan produk saya —");

            // Searchable: a catalogue of eighty is not a list to scroll on a
            // phone with a parcel in the other hand.
            Picker picker = Picker.create(this, options, "Pilih produk", "— pilih produk —");
            picker.select(0);
            picker.onPicked(idx -> c.chosen = idx < c.ranked.size() ? idx : -1);
            block.addView(picker.view(), new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT));

            EditText qty = new EditText(this);
            qty.setInputType(InputType.TYPE_CLASS_NUMBER);
            qty.setText("1");
            qty.setHint("Jumlah");
            qty.setSelectAllOnFocus(true);
            c.qtyField = qty;
            // Full width. Added with no layout params it took wrap_content —
            // a box the width of the "1" inside it, which is a target nobody
            // can reliably hit and which reads as not editable at all.
            block.addView(qty, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT));
        }

        // Add a product by hand. The whole catalogue, not just what was read:
        // the label may name something the reader never saw, and until now the
        // only way to record it was to go and find a computer.
        final List<Candidate> manual = new ArrayList<>();
        TextView addLabel = new TextView(this);
        addLabel.setText("Tambah produk sendiri");
        addLabel.setTextSize(11);
        addLabel.setPadding(0, (int) (14 * d), 0, (int) (4 * d));
        root.addView(addLabel);

        final LinearLayout manualRows = new LinearLayout(this);
        manualRows.setOrientation(LinearLayout.VERTICAL);
        root.addView(manualRows);

        Button addBtn = new Button(this);
        addBtn.setText("+ Tambah produk");
        addBtn.setAllCaps(false);
        addBtn.setOnClickListener(v -> {
            if (catalogue.isEmpty()) {
                Toast.makeText(this, "Master produk belum termuat.", Toast.LENGTH_SHORT).show();
                return;
            }
            List<ProductMatcher.Match> all = new ArrayList<>();
            for (ProductMatcher.Product p : catalogue) all.add(ProductMatcher.pick(p));
            final Candidate c = new Candidate(null, all);
            c.manual = true;
            manual.add(c);

            List<String> names = new ArrayList<>();
            for (ProductMatcher.Match m : all) names.add(m.product.name);

            final LinearLayout mBlock = new LinearLayout(this);
            mBlock.setOrientation(LinearLayout.VERTICAL);
            manualRows.addView(mBlock);

            // Adding a line and then not being able to take it back is how a
            // mis-tap becomes a stock movement.
            MaterialButton mDel = new MaterialButton(this, null,
                    com.google.android.material.R.attr.materialButtonOutlinedStyle);
            mDel.setText("Hapus baris ini");
            mDel.setAllCaps(false);
            mDel.setTextSize(11);
            mDel.setOnClickListener(v2 -> {
                c.chosen = -1;
                c.qtyField = null;
                manual.remove(c);
                manualRows.removeView(mBlock);
            });

            Picker mPicker = Picker.create(this, names, "Pilih produk", "— pilih produk —");
            mPicker.onPicked(idx -> c.chosen = idx);
            mBlock.addView(mPicker.view(), new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT));

            EditText q = new EditText(this);
            q.setInputType(InputType.TYPE_CLASS_NUMBER);
            q.setText("1");
            q.setHint("Jumlah");
            q.setSelectAllOnFocus(true);
            c.qtyField = q;
            mBlock.addView(q, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT));
            mBlock.addView(mDel);
        });
        root.addView(addBtn);

        // Where the parcel came from. Below the contents because that is the
        // order the packer works in — what is in the box, then whose box it is
        // — and because the shop usually stays the same for a whole session
        // while the contents change every parcel.
        TextView originLabel = new TextView(this);
        originLabel.setText("Asal paket");
        originLabel.setTextSize(11);
        originLabel.setPadding(0, (int) (18 * d), 0, (int) (4 * d));
        root.addView(originLabel);

        final Spinner shopSpinner = new Spinner(this);
        List<String> shopNames = new ArrayList<>();
        shopNames.add("— pilih toko —");
        for (String[] sh : shopList) shopNames.add(sh[1] + "  (" + sh[2] + ")");
        shopSpinner.setAdapter(new ArrayAdapter<>(
                this, android.R.layout.simple_spinner_dropdown_item, shopNames));
        // Carried over from the last parcel, not guessed from the label: a
        // bench packs one shop at a time, and the previous answer is a better
        // prior than OCR on a sender line the courier prints in 6pt.
        // Order of preference: what the label says, then the shop the last
        // parcel went to, then simply the first — never nothing, which is what
        // was asked for. All three are one tap from being changed.
        int shopGuess = guessShopIndex();
        if (shopGuess > 0) {
            shopSpinner.setSelection(shopGuess);
        } else if (lastShopIndex > 0 && lastShopIndex < shopNames.size()) {
            shopSpinner.setSelection(lastShopIndex);
        } else if (shopNames.size() > 1) {
            shopSpinner.setSelection(1);
        }
        root.addView(shopSpinner);

        final Spinner courierSpinner = new Spinner(this);
        List<String> courierNames = new ArrayList<>();
        courierNames.add("— pilih kurir —");
        courierNames.addAll(courierList);
        final ArrayAdapter<String> courierAdapter = new ArrayAdapter<>(
                this, android.R.layout.simple_spinner_dropdown_item, courierNames);
        courierSpinner.setAdapter(courierAdapter);
        // The barcode already told us the carrier more reliably than any
        // guess, so it is preselected — and still shown, so a wrong read is
        // visible rather than filed silently.
        // "JSTPRESS" is J&T for ever once somebody has said so.
        String detected = FuzzyMatch.recall("courier", reader.rawText());
        if (detected == null) detected = guessCourier(reader.rawText());
        int courierGuess = detected == null ? -1 : courierNames.indexOf(detected);
        if (courierGuess > 0) courierSpinner.setSelection(courierGuess);
        else if (lastCourierIndex > 0 && lastCourierIndex < courierNames.size()) {
            courierSpinner.setSelection(lastCourierIndex);
        } else if (courierNames.size() > 1) {
            courierSpinner.setSelection(1);
        }
        root.addView(courierSpinner);
        // Kurirnya bisa ditambah dari sini juga. Kebutuhannya muncul saat
        // paket sedang dipegang; menyuruh orang menyeberang layar pada saat
        // itu berarti kurirnya tidak akan diisi sama sekali.
        root.addView(CourierPicker.tombolTambah(this, api, courierAdapter,
                courierNames, courierSpinner, courierList));

        final TextView originNote = new TextView(this);
        originNote.setTextSize(11);
        originNote.setTextColor(Color.parseColor("#6B7178"));
        originNote.setPadding(0, (int) (6 * d), 0, 0);
        originNote.setText(shopList.isEmpty()
                ? "Master toko belum termuat — asal paket bisa diisi nanti lewat web."
                : "Tanpa toko, paket ini tidak masuk hitungan penjualan toko mana pun.");
        root.addView(originNote);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);

        final androidx.appcompat.app.AlertDialog dialog = new MaterialAlertDialogBuilder(this)
                .setTitle(candidates.isEmpty()
                        ? "Isi paket"
                        : "Cocokkan isi paket (" + candidates.size() + ")")
                .setView(scroll)
                // Not cancellable by tapping away: the scan is already held
                // open and a dismissed dialog would leave the parcel unsaved
                // with nothing on screen to say so.
                .setCancelable(false)
                .setPositiveButton("Simpan", null)
                .setNeutralButton("Tambah produk baru", null)
                // Not "skip": nothing is saved. A packer who scanned the
                // carton's own barcode needs a way back to the camera, and
                // that way must not be one that files an empty parcel.
                .setNegativeButton("Batal, jangan simpan", (dlg, w) -> {
                    Toast.makeText(this, "Scan dibatalkan, tidak disimpan.",
                            Toast.LENGTH_SHORT).show();
                    // Muted so the same code in frame is not read straight
                    // back in; the packer is about to point at something else.
                    mute(resi);
                    idle();
                })
                .create();

        // Wired after show() so a refusal can keep the sheet open. Handing the
        // listener to the builder dismisses the dialog before it runs, which
        // is exactly wrong here: the whole point is that an unanswered sheet
        // does not go away.
        if (dialog.getWindow() != null) {
            // Without this the sheet keeps its height and the quantity box can
            // sit behind the keyboard, which looks exactly like a field that
            // will not accept typing.
            dialog.getWindow().setSoftInputMode(
                    android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        }
        dialog.setOnShowListener(dd -> {
            dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(bv -> {
                    candidates.addAll(manual);
                    for (Candidate c : candidates) {
                        // Null once the row was deleted; chosen is -1 by then
                        // so the line is dropped anyway, but reading a field
                        // that is gone would take the whole save down with it.
                        if (c.qtyField == null) continue;
                        try {
                            double v = Double.parseDouble(c.qtyField.getText().toString().trim());
                            if (v > 0 && v <= 9999) c.qty = v;
                        } catch (Exception ignored) {
                            // Left at 1, which is what almost every parcel holds.
                        }
                    }
                    // Nothing chosen is not an answer. The packer is
                    // holding the parcel; if the label names something the
                    // catalogue lacks, the neutral button adds it rather than
                    // letting the contents be recorded as unknown.
                    int chosen = 0;
                    for (Candidate c : candidates) {
                        if (c.chosen >= 0 && c.chosen < c.ranked.size()) chosen++;
                    }
                    if (chosen == 0) {
                        candidates.removeAll(manual);
                        Toast.makeText(this,
                                "Pilih minimal satu produk. Kalau belum ada di master, "
                                        + "pakai \"Tambah produk baru\".",
                                Toast.LENGTH_LONG).show();
                        return;
                    }
                    lastShopIndex = shopSpinner.getSelectedItemPosition();
                    lastCourierIndex = courierSpinner.getSelectedItemPosition();

                    JSONObject payload = reading(candidates, true);
                    try {
                        int si = shopSpinner.getSelectedItemPosition();
                        if (si > 0 && si - 1 < shopList.size()) {
                            payload.put("shopId", shopList.get(si - 1)[0]);
                            payload.put("marketplace", shopList.get(si - 1)[2]);
                        }
                        int ci = courierSpinner.getSelectedItemPosition();
                        if (ci > 0) payload.put("courierConfirmed", courierNames.get(ci));
                    } catch (Exception ignored) {}

                    dialog.dismiss();
                    submit(resi, raw, format, photoBase64, payload);
            });

            dialog.getButton(android.app.AlertDialog.BUTTON_NEUTRAL).setOnClickListener(bv ->
                    promptNewProduct(name -> {
                        List<ProductMatcher.Match> all = new ArrayList<>();
                        for (ProductMatcher.Product p : catalogue) all.add(ProductMatcher.pick(p));
                        final Candidate c = new Candidate(null, all);
                        c.manual = true;
                        // The one just created is last in the catalogue.
                        c.chosen = all.size() - 1;
                        manual.add(c);
                        TextView added = new TextView(this);
                        added.setText("Ditambahkan: " + name + "  (jumlah 1)");
                        added.setTextSize(12);
                        added.setTextColor(Color.parseColor("#1B7F4B"));
                        manualRows.addView(added);
                    }));
        });
        dialog.show();
    }

    /**
     * Create a product without leaving the bench.
     *
     * The SKU is generated because nobody standing at a packing table has one
     * to hand, and a blank would collide with the next blank. It is editable
     * later on the web, where that is somebody's actual job.
     */
    private void promptNewProduct(java.util.function.Consumer<String> onCreated) {
        final EditText input = new EditText(this);
        input.setHint("Nama produk seperti di master");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);

        new MaterialAlertDialogBuilder(this)
                .setTitle("Produk baru")
                .setMessage("Produk ini akan masuk ke master produk dan bisa dirapikan "
                        + "lewat web nanti.")
                .setView(input)
                .setPositiveButton("Simpan", (d, w) -> {
                    String name = input.getText().toString().trim();
                    if (name.length() < 2) {
                        Toast.makeText(this, "Nama produk terlalu pendek.", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    String sku = name.toUpperCase(java.util.Locale.ROOT)
                            .replaceAll("[^A-Z0-9]", "")
                            .replaceAll("^(.{0,12}).*$", "$1")
                            + "-" + (System.currentTimeMillis() % 100000);
                    api.createProduct(name, sku, r -> {
                        if (!r.ok() || r.data() == null) {
                            Toast.makeText(this, r.message("Gagal menambah produk."),
                                    Toast.LENGTH_LONG).show();
                            return;
                        }
                        String id = r.data().optString("id");
                        catalogue.add(new ProductMatcher.Product(id, name, sku));
                        Toast.makeText(this, "Produk ditambahkan.", Toast.LENGTH_SHORT).show();
                        onCreated.accept(name);
                    });
                })
                .setNegativeButton("Batal", null)
                .show();
    }

    /**
     * The phone's reading, as the payload the server stores.
     *
     * The label's own wording travels with every line rather than being
     * replaced by the product name. When a match turns out wrong, that text is
     * the only way to see what the machine was looking at.
     */
    private JSONObject reading(List<Candidate> candidates, boolean confirmed) {
        JSONObject out = new JSONObject();
        try {
            if (!seenCodes.isEmpty()) {
                JSONArray codes = new JSONArray();
                for (String c : seenCodes) {
                    JSONObject o = new JSONObject();
                    o.put("value", c);
                    codes.put(o);
                }
                out.put("codes", codes);
            }
            // Yang dipakai adalah hasil panduan, bukan tebakan mentah
            // pembaca label: ia sudah lulus pemeriksaan bentuk, atau diketik
            // orang yang memegang labelnya.
            String orderNo = orderIdFinal != null ? orderIdFinal
                    : OrderId.cari(reader.rawText());
            if (orderNo != null) {
                out.put("labelOrderNo", orderNo);
                out.put("orderNoSource", orderIdFinal != null && orderIdSumber != null
                        ? orderIdSumber : "ocr");
            }

            String text = reader.rawText();
            if (text != null && !text.isEmpty()) {
                out.put("deviceText", text.length() > 20000 ? text.substring(0, 20000) : text);
            }
            out.put("deviceClarity", clarity);

            JSONArray items = new JSONArray();
            for (Candidate c : candidates) {
                if (c.chosen < 0 || c.chosen >= c.ranked.size()) continue;
                ProductMatcher.Match m = c.ranked.get(c.chosen);
                JSONObject item = new JSONObject();
                item.put("masterProductId", m.product.id);
                // rawName is what the LABEL said. A hand-added line has no
                // label wording behind it, and inventing one would make a
                // choice look like a reading.
                if (c.rawText != null) {
                    item.put("rawName",
                            c.rawText.length() > 255 ? c.rawText.substring(0, 255) : c.rawText);
                }
                item.put("qty", c.qty);
                item.put("source", confirmed ? "device_confirmed" : "device_auto");
                if (!c.manual) item.put("matchScore", Math.round(m.score * 1000) / 1000.0);
                items.put(item);
            }
            if (items.length() > 0) out.put("items", items);
        } catch (Exception ignored) {
            // A malformed extra must never cost the scan; the resi still goes.
        }
        return out;
    }

    /** What the phone has worked out so far, while the packer is still aiming. */
    private void renderLive() {
        if (liveRead == null) return;
        StringBuilder sb = new StringBuilder();

        String orderNo = reader.orderNo();
        if (orderNo != null) {
            sb.append("Pesanan ").append(orderNo)
              .append("  (").append(reader.orderSightings()).append(" frame)");
        }

        int shown = 0;
        for (LabelReader.Line line : reader.productLines()) {
            ProductMatcher.Match m = ProductMatcher.best(line.text, catalogue);
            if (m == null) continue;
            if (sb.length() > 0) sb.append('\n');
            sb.append(m.confident ? "\u2713 " : "? ")
              .append(m.product.name)
              .append("  ").append(Math.round(m.score * 100)).append('%');
            if (++shown >= 3) break;
        }

        if (sb.length() == 0) {
            liveRead.setVisibility(View.GONE);
            return;
        }
        liveRead.setText(sb.toString());
        liveRead.setVisibility(View.VISIBLE);
    }

    private void submit(String resi, String raw, String format, String photoBase64,
                        JSONObject reading) {
        hint.setText("Menyimpan...");
        api.scan(resi, raw, "barcode", format, photoBase64, reading, r -> {
            // NOT released here.
            //
            // Clearing busy the moment the response landed put the camera back
            // to work while the screen was still showing the result and while
            // a dialog was still open — so the sheet still in frame was read
            // again, refused as a duplicate, and "Halaman lain dari resi ini?"
            // appeared on top of a parcel that had not finished. busy now means
            // "this parcel is not finished with", and only idle() ends that.

            if (r.ok()) {
                feedback(true);
                String extra = "Tersimpan";
                if (r.data() != null && r.data().optJSONObject("linkedOrder") != null) {
                    extra = "Tersimpan, order "
                            + r.data().optJSONObject("linkedOrder").optString("marketplaceOrderId")
                            + " jadi Dikirim";
                }
                // Saved either way, but a blurred photo is worth saying out
                // loud: the label data will come back thin and the packer is
                // the only one who can retake it.
                if (tookBlurred) {
                    showBanner(false, resi, extra + ", tapi foto kurang tajam - data label mungkin tidak terbaca");
                } else {
                    showBanner(true, resi, extra);
                }
                refreshCounter();

                // The parcel is saved; now record that its contents were
                // checked by a person rather than matched by the phone. Only
                // sent when there was something to check -- the server refuses
                // an empty or half-mapped sheet, and a refusal here would be
                // noise on a scan that is otherwise fine.
                String scanId = r.data() != null ? r.data().optString("id", "") : "";
                boolean hadItems = r.data() != null
                        && r.data().optInt("itemCount", 1) != 0;
                kirimFotoSisa(scanId);
                if (!scanId.isEmpty() && hadItems) {
                    api.confirmItems(scanId, c -> done(resi));
                } else {
                    done(resi);
                }
                return;
            }

            if (r.code == 409 && r.body != null && "DUPLICATE".equals(r.body.optString("code"))) {
                feedback(false);
                String when = Format.humanTime(r.body.optString("firstScannedAt", null));
                String device = r.body.optString("deviceLabel", "");
                StringBuilder sb = new StringBuilder("Sudah discan");
                if (when != null) sb.append(" ").append(when);
                if (device != null && !device.isEmpty() && !"null".equals(device)) {
                    sb.append(" - ").append(device);
                }
                showBanner(false, resi, sb.toString());
                // Same reason as done(): without this the sheet is read again
                // the moment the dialog closes.
                mute(resi);

                // A refused duplicate is often not a mistake: some orders print
                // across two or three sheets that all carry the same waybill,
                // and the pages holding the rest of the product table were
                // never photographed because the guard turned them away. Ask.
                String scanId = r.body.optString("scanId", "");
                if (!scanId.isEmpty() && photoBase64 != null) {
                    offerExtraPage(scanId, resi, photoBase64);
                } else {
                    idle();
                }
                return;
            }

            if (r.code == 401) {
                Toast.makeText(this, "Sesi berakhir. Silakan masuk lagi.", Toast.LENGTH_LONG).show();
                session.clear();
                startActivity(new Intent(this, LoginActivity.class));
                finish();
                return;
            }

            // Unmute so a genuine failure can simply be re-scanned.
            mutedResi = null;
            feedback(false);
            showBanner(false, resi, r.message("Gagal menyimpan (kode " + r.code + ")"));
            idle();
        });
    }

    /**
     * Offer to file the just-rejected photo as another sheet of the same
     * waybill.
     *
     * The photo is the one already taken. Asking the packer to aim at the same
     * sheet a second time, right after being told the parcel is a duplicate,
     * is how a feature ends up never being used.
     */
    private void offerExtraPage(String scanId, String resi, String photoBase64) {
        new MaterialAlertDialogBuilder(this)
                .setTitle("Halaman lain dari resi ini?")
                .setMessage("Resi " + resi + " sudah pernah discan.\n\n"
                        + "Kalau lembar ini adalah halaman lanjutan dari resi yang sama, "
                        + "fotonya bisa ditambahkan supaya isinya ikut terbaca.")
                .setCancelable(false)
                .setPositiveButton("Ya, tambah halaman", (d, w) -> {
                    hint.setText("Menambah halaman...");
                    api.addPage(scanId, photoBase64, reader.rawText(), r2 -> {
                        if (r2.ok()) {
                            feedback(true);
                            int page = r2.data() != null ? r2.data().optInt("pageNo", 0) : 0;
                            showBanner(true, resi,
                                    page > 0 ? "Halaman " + page + " ditambahkan" : "Halaman ditambahkan");
                        } else {
                            feedback(false);
                            showBanner(false, resi, r2.message("Gagal menambah halaman"));
                        }
                        idle();
                    });
                })
                .setNegativeButton("Bukan", (d, w) -> idle())
                .show();
    }

    /**
     * Say, unmistakably, that this parcel is finished.
     *
     * The scan is no longer instant: focus, then a second of reading, then the
     * upload, and sometimes a dialog in between. Through all of that the screen
     * looked much as it does when idle, so a packer had no way to know whether
     * to keep holding the parcel or reach for the next one — and the honest
     * answer to "am I done?" is worth more than any of the data on screen.
     */
    private void done(String resi) {
        // Re-armed from the moment the scan FINISHED, not from when the
        // barcode was first seen. The mute is five seconds and a scan takes
        // several — focus, reading, then uploading a 2.5MP photo over
        // warehouse wifi — so by the time the packer saw "SELESAI" the window
        // protecting them from re-reading the same sheet had already expired.
        mute(resi);
        status.setText("SELESAI");
        status.setTextColor(Color.parseColor("#1B7F4B"));
        detail.setText(resi);
        detail.setTextColor(Color.parseColor("#1B7F4B"));
        detail.setVisibility(View.VISIBLE);
        hint.setText("Lanjut ke resi berikutnya.");
        main.postDelayed(this::idle, DONE_HOLD_MS);
    }

    /**
     * The errands that are not scanning.
     *
     * They used to sit on the scan screen as buttons of equal weight, which
     * made "Keluar" look exactly as inviting as the two actions used all day.
     * In a sheet each one has room to say what it is for.
     */
    /**
     * The one control that helps every other part of this screen.
     *
     * A dim bench costs the barcode a read, the clarity meter its score and the
     * label reader its text; all three improve from the same switch.
     */
    private void toggleTorch() {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) {
            Toast.makeText(this, "Lampu tidak tersedia di kamera ini.", Toast.LENGTH_SHORT).show();
            return;
        }
        torchOn = !torchOn;
        camera.getCameraControl().enableTorch(torchOn);
        ((com.google.android.material.button.MaterialButton) findViewById(R.id.torch))
                .setText(torchOn ? "Lampu ✓" : "Lampu");
    }

    /**
     * Ask once, on Android 13+, and never insist.
     *
     * Refusing costs the reminder and nothing else, so there is no second
     * prompt and no explanation screen: the setting in the menu says plainly
     * that notifications are off, which is where somebody who changes their
     * mind will actually look.
     */
    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        try {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 91);
        } catch (Exception ignored) {}
    }

    /** What the menu row says without being opened. */
    private String reminderSummary() {
        if (!session.reminderEnabled()) return "Mati";
        return String.format(java.util.Locale.ROOT,
                "Aktif setiap hari jam %02d:00", session.reminderHour());
    }

    /**
     * Switch the reminder off, or move it.
     *
     * The hour matters more than it looks: a reminder that lands after the
     * suppliers stop taking orders tells somebody about a problem they can no
     * longer do anything about today, which is how a notification becomes
     * noise.
     */
    private void showReminderSettings() {
        final boolean[] on = { session.reminderEnabled() };
        final int[] hour = { session.reminderHour() };

        float d = getResources().getDisplayMetrics().density;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * d);
        root.setPadding(pad, pad, pad, pad);

        final CheckBox enable = new CheckBox(this);
        enable.setText("Ingatkan cek stok setiap hari");
        enable.setChecked(on[0]);
        root.addView(enable);

        TextView label = new TextView(this);
        label.setText("Jam pengingat");
        label.setTextSize(12);
        label.setPadding(0, (int) (14 * d), 0, (int) (4 * d));
        root.addView(label);

        final Spinner hours = new Spinner(this);
        List<String> opts = new ArrayList<>();
        for (int h = 0; h < 24; h++) opts.add(String.format(java.util.Locale.ROOT, "%02d:00", h));
        hours.setAdapter(new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, opts));
        hours.setSelection(hour[0]);
        root.addView(hours);

        final TextView note = new TextView(this);
        note.setTextSize(11);
        note.setTextColor(Color.parseColor("#6B7178"));
        note.setPadding(0, (int) (12 * d), 0, 0);
        note.setText("Pengingat hanya muncul kalau masih ada bahan yang belum "
                + "diperbarui hari itu. Kalau rekan sudah mengeceknya, tidak ada notifikasi.");
        root.addView(note);

        new MaterialAlertDialogBuilder(this)
                .setTitle("Pengingat Stok Harian")
                .setView(root)
                .setPositiveButton("Simpan", (dlg, w) -> {
                    session.setReminderEnabled(enable.isChecked());
                    session.setReminderHour(hours.getSelectedItemPosition());
                    // schedule() cancels when the setting is off, so one call
                    // covers both directions.
                    StockReminder.schedule(this);
                    Toast.makeText(this,
                            enable.isChecked()
                                    ? "Pengingat aktif jam "
                                        + String.format(java.util.Locale.ROOT, "%02d:00",
                                            hours.getSelectedItemPosition())
                                    : "Pengingat dimatikan.",
                            Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Batal", null)
                .show();
    }

    /**
     * The shops and couriers to choose between.
     *
     * Fetched once rather than per parcel: the list changes when a shop is
     * added, which is a monthly event, and a request per scan would put a
     * round trip in front of the sheet the packer is waiting on.
     */
    /**
     * Which shop the label's wording points at, as an index into shopSpinner.
     *
     * Zero means "no idea": the spinner's first entry is the placeholder, so
     * the shop list is offset by one throughout.
     */
    private int guessShopIndex() {
        String text = reader.rawText();
        if (text == null || shopList.isEmpty()) return 0;

        // What this sender line has been answered with before beats any score.
        String remembered = FuzzyMatch.recall("shop", text);
        if (remembered != null) {
            for (int i = 0; i < shopList.size(); i++) {
                if (shopList.get(i)[0].equals(remembered)) return i + 1;
            }
        }
        List<ProductMatcher.Product> asProducts = new ArrayList<>();
        for (String[] sh : shopList) {
            asProducts.add(new ProductMatcher.Product(sh[0], sh[1], ""));
        }
        FuzzyMatch.Scored s = FuzzyMatch.best(text, asProducts);
        if (s == null) return 0;
        for (int i = 0; i < shopList.size(); i++) {
            if (shopList.get(i)[0].equals(s.product.id)) return i + 1;
        }
        return 0;
    }

    /**
     * The carrier, from the words on the label.
     *
     * Mirrors label-parser's COURIERS on the server. Duplicated deliberately:
     * the sheet opens before anything is uploaded, so asking the server would
     * put a round trip in front of the packer, and the cost of being wrong is
     * one tap on a picker they are looking at anyway.
     */
    private String guessCourier(String text) {
        if (text == null || text.isEmpty()) return null;
        String t = text.toLowerCase(java.util.Locale.ROOT);
        if (t.contains("j&t") || t.contains("jnt")) return "J&T";
        if (t.contains("jne")) return "JNE";
        if (t.contains("spx") || t.contains("shopee express")) return "SPX";
        if (t.contains("sicepat")) return "SiCepat";
        if (t.contains("anteraja")) return "Anteraja";
        if (t.contains("ninja")) return "Ninja";
        if (t.contains("lion")) return "Lion Parcel";
        if (t.contains("id express")) return "ID Express";
        if (t.contains("pos indonesia")) return "POS";
        return null;
    }

    /** Corrections already made, newest and most-confirmed first. */
    private void loadOcrMemory() {
        api.ocrHints(r -> {
            if (!r.ok() || r.dataArray() == null) return;
            ocrMemory.clear();
            JSONArray arr = r.dataArray();
            java.util.HashMap<String, java.util.LinkedHashMap<String, String>> byKind =
                    new java.util.HashMap<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String kind = o.optString("kind", "");
                String raw = o.optString("raw", "");
                // A courier's answer is a name, not a row.
                String target = "courier".equals(kind)
                        ? o.optString("targetText", "")
                        : o.optString("targetId", "");
                if (kind.isEmpty() || raw.isEmpty() || target.isEmpty()) continue;

                java.util.LinkedHashMap<String, String> m = byKind.get(kind);
                if (m == null) { m = new java.util.LinkedHashMap<>(); byKind.put(kind, m); }
                // Server sends strongest first, so the first answer for a
                // reading wins and later, weaker ones do not overwrite it.
                if (!m.containsKey(raw)) m.put(raw, target);
                if ("product".equals(kind) && !ocrMemory.containsKey(raw)) {
                    ocrMemory.put(raw, target);
                }
            }
            // Shared with the delivery sheet and the history editors, which
            // ask the same question of the same corrections.
            for (java.util.Map.Entry<String, java.util.LinkedHashMap<String, String>> e
                    : byKind.entrySet()) {
                FuzzyMatch.setMemory(e.getKey(), e.getValue());
            }
        });
    }

    /** Same normalisation the server stores keys under. */
    private static String normaliseForMemory(String raw) {
        if (raw == null) return "";
        return raw.toLowerCase(java.util.Locale.ROOT)
                .replaceAll("[^a-z0-9]+", " ")
                .trim();
    }

    /**
     * A product this exact reading has been answered with before.
     *
     * Exact key first, then close keys: the same label photographed twice
     * rarely reads identically, but it reads nearly so, and "nearly" is what
     * the similarity function is for. Null when nothing has been learned.
     */
    private ProductMatcher.Product recall(String rawLine) {
        String key = normaliseForMemory(rawLine);
        if (key.length() < 4 || ocrMemory.isEmpty()) return null;

        String id = ocrMemory.get(key);
        if (id == null) {
            double bestSim = 0;
            for (java.util.Map.Entry<String, String> e : ocrMemory.entrySet()) {
                double sim = FuzzyMatch.similarity(key, e.getKey());
                if (sim > bestSim) { bestSim = sim; id = e.getValue(); }
            }
            // High bar: a remembered reading is being trusted without any
            // scoring against the catalogue, so it has to be nearly the same
            // reading rather than merely a similar one.
            if (bestSim < 0.85) return null;
        }
        for (ProductMatcher.Product p : catalogue) {
            if (p.id.equals(id)) return p;
        }
        return null;
    }

    private void loadMappingOptions() {
        api.mappingOptions(r -> {
            if (!r.ok() || r.data() == null) return;
            shopList.clear();
            courierList.clear();
            JSONArray shops = r.data().optJSONArray("shops");
            if (shops != null) {
                for (int i = 0; i < shops.length(); i++) {
                    JSONObject o = shops.optJSONObject(i);
                    if (o == null) continue;
                    shopList.add(new String[]{
                            o.optString("id"), o.optString("name"), o.optString("marketplace")});
                }
            }
            JSONArray couriers = r.data().optJSONArray("couriers");
            if (couriers != null) {
                for (int i = 0; i < couriers.length(); i++) courierList.add(couriers.optString(i));
            }
        });
    }

    /**
     * The day's packing, shown and then shareable.
     *
     * Shown first rather than sent straight to WhatsApp: a packer about to
     * report a number to their supervisor should see it before it leaves,
     * especially the incomplete counts — which are the part that gets asked
     * about.
     */
    private void showRecap() {
        api.dailyRecap(r -> {
            if (!r.ok() || r.data() == null) {
                Toast.makeText(this, r.message("Gagal memuat rekap."), Toast.LENGTH_LONG).show();
                return;
            }
            JSONObject d = r.data();
            final String text = recapText(d);

            new MaterialAlertDialogBuilder(this)
                    .setTitle("Rekap " + d.optString("date", ""))
                    .setMessage(text)
                    .setPositiveButton("Bagikan ke WhatsApp", (dlg, w) -> {
                        Intent i = new Intent(Intent.ACTION_VIEW);
                        i.setData(android.net.Uri.parse(
                                "https://api.whatsapp.com/send?text="
                                        + android.net.Uri.encode(text)));
                        try {
                            startActivity(i);
                        } catch (Exception e) {
                            Toast.makeText(this, "WhatsApp tidak ditemukan di HP ini.",
                                    Toast.LENGTH_LONG).show();
                        }
                    })
                    .setNegativeButton("Tutup", null)
                    .show();
        });
    }

    /**
     * The message itself.
     *
     * Incomplete counts are named rather than omitted when zero is not the
     * answer: a recap that reports only the total invites the reply "and how
     * many of those are actually finished?".
     */
    private String recapText(JSONObject d) {
        StringBuilder b = new StringBuilder();
        b.append("*Rekap Packing ").append(d.optString("date", "")).append("*\n");
        b.append("Total resi: ").append(d.optInt("total", 0)).append("\n");

        JSONArray couriers = d.optJSONArray("couriers");
        if (couriers != null && couriers.length() > 0) {
            b.append("\nPer kurir:\n");
            for (int i = 0; i < couriers.length(); i++) {
                JSONObject c = couriers.optJSONObject(i);
                if (c == null) continue;
                b.append("- ").append(c.optString("courier"))
                 .append(": ").append(c.optInt("count", 0)).append("\n");
            }
        }

        JSONArray devices = d.optJSONArray("devices");
        if (devices != null && devices.length() > 1) {
            // Only when more than one phone worked that day; otherwise it is a
            // line saying the obvious.
            b.append("\nPer alat:\n");
            for (int i = 0; i < devices.length(); i++) {
                JSONObject dv = devices.optJSONObject(i);
                if (dv == null) continue;
                b.append("- ").append(dv.optString("device"))
                 .append(": ").append(dv.optInt("count", 0)).append("\n");
            }
        }

        int unmapped = d.optInt("unmapped", 0);
        int unconfirmed = d.optInt("unconfirmedItems", 0);
        b.append("\n");
        if (unmapped == 0 && unconfirmed == 0) {
            b.append("Semua resi sudah lengkap.");
        } else {
            if (unmapped > 0) {
                b.append("Belum dipetakan ke toko: ").append(unmapped).append("\n");
            }
            if (unconfirmed > 0) {
                b.append("Isi paket belum dikonfirmasi: ").append(unconfirmed).append("\n");
            }
        }
        return b.toString();
    }

    private void showMenu() {
        View sheet = getLayoutInflater().inflate(R.layout.sheet_menu, null);
        com.google.android.material.bottomsheet.BottomSheetDialog dialog =
                new com.google.android.material.bottomsheet.BottomSheetDialog(this);
        dialog.setContentView(sheet);

        TextView account = sheet.findViewById(R.id.menuAccount);
        String who = session.email();
        account.setText(who == null || who.isEmpty() ? "Keluar dari aplikasi" : who);

        sheet.findViewById(R.id.menuDelivery).setOnClickListener(v -> {
            dialog.dismiss();
            startActivity(new Intent(this, DeliveryActivity.class));
        });
        sheet.findViewById(R.id.menuStock).setOnClickListener(v -> {
            dialog.dismiss();
            startActivity(new Intent(this, StockActivity.class));
        });
        sheet.findViewById(R.id.menuTextScan).setOnClickListener(v -> {
            dialog.dismiss();
            startActivity(new Intent(this, TextScanActivity.class));
        });
        sheet.findViewById(R.id.menuHistory).setOnClickListener(v -> {
            dialog.dismiss();
            startActivity(new Intent(this, HistoryActivity.class));
        });
        sheet.findViewById(R.id.menuRecap).setOnClickListener(v -> {
            dialog.dismiss();
            showRecap();
        });

        sheet.findViewById(R.id.menuDashboard).setOnClickListener(v -> {
            dialog.dismiss();
            startActivity(new Intent(this, DashboardActivity.class));
        });
        sheet.findViewById(R.id.menuPayout).setOnClickListener(v -> {
            dialog.dismiss();
            startActivity(new Intent(this, PayoutActivity.class));
        });
        sheet.findViewById(R.id.menuPending).setOnClickListener(v -> {
            dialog.dismiss();
            startActivity(new Intent(this, PendingActivity.class));
        });

        // The count on the row itself, so it is visible without opening
        // anything — the whole reason the web version sits on the dashboard.
        final TextView pendingTitle = sheet.findViewById(R.id.menuPendingTitle);
        api.pendingTasks(r -> {
            if (!r.ok() || r.data() == null) return;
            int total = r.data().optInt("total", 0);
            if (total > 0) pendingTitle.setText("Data Belum Lengkap (" + total + ")");
        });

        TextView reminderState = sheet.findViewById(R.id.menuReminderState);
        reminderState.setText(reminderSummary());
        sheet.findViewById(R.id.menuReminder).setOnClickListener(v -> {
            dialog.dismiss();
            showReminderSettings();
        });

        // Versi terpasang ditulis di barisnya sendiri, dan diganti kalau
        // server ternyata punya yang lebih baru. APK di luar Play Store
        // tidak punya yang memberi tahu; tanpa ini satu-satunya cara tahu
        // adalah membuka halaman web di komputer.
        final TextView updateState = sheet.findViewById(R.id.menuUpdateState);
        sheet.findViewById(R.id.menuUpdate).setOnClickListener(v -> {
            dialog.dismiss();
            startActivity(new Intent(this, UpdateActivity.class));
        });
        try {
            android.content.pm.PackageInfo pi =
                    getPackageManager().getPackageInfo(getPackageName(), 0);
            final int terpasang =
                    android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P
                            ? (int) pi.getLongVersionCode() : pi.versionCode;
            updateState.setText("Versi " + pi.versionName + " terpasang");
            api.appReleases(r -> {
                if (!r.ok() || r.data() == null) return;
                org.json.JSONObject cur = r.data().optJSONObject("current");
                if (cur == null) return;
                if (cur.optInt("versionCode", 0) > terpasang) {
                    updateState.setText("Versi baru tersedia: "
                            + cur.optString("versionName", ""));
                    updateState.setTextColor(android.graphics.Color.parseColor("#8A5A00"));
                }
            });
        } catch (Exception ignored) {}

        // Menu yang tidak boleh dibuka akun ini disembunyikan. Baris yang
        // selalu menolak saat diketuk terbaca sebagai aplikasi rusak, bukan
        // sebagai akses yang memang tidak diberikan.
        final int[][] menuIzin = {
            {R.id.menuDashboard, 0}, {R.id.menuDelivery, 1}, {R.id.menuStock, 1},
            {R.id.menuTextScan, 2}, {R.id.menuHistory, 3}, {R.id.menuRecap, 3},
            {R.id.menuPayout, 4}, {R.id.menuPending, 0},
        };
        final String[] kunci = {"dashboard", "bahan", "produk", "scan", "pencairan"};
        for (int[] pasangan : menuIzin) {
            View baris = sheet.findViewById(pasangan[0]);
            if (baris != null && !Access.boleh(kunci[pasangan[1]])) {
                baris.setVisibility(View.GONE);
            }
        }

        // Mengelola karyawan hanya untuk pemiliknya. Karyawan yang bisa
        // membuat karyawan lain membuat seluruh lapisan izin tidak ada artinya.
        View barisStaf = sheet.findViewById(R.id.menuStaff);
        if (barisStaf != null) {
            if (Access.termuat() && !Access.pemilik()) {
                barisStaf.setVisibility(View.GONE);
            } else {
                barisStaf.setOnClickListener(v -> {
                    dialog.dismiss();
                    startActivity(new Intent(this, StaffActivity.class));
                });
            }
        }

        sheet.findViewById(R.id.menuLogout).setOnClickListener(v -> {
            dialog.dismiss();
            session.clear();
            // Izin akun sebelumnya harus ikut dilupakan, kalau tidak orang
            // berikutnya yang masuk di HP ini melihat menu milik yang tadi.
            Access.lupakan();
            startActivity(new Intent(this, LoginActivity.class));
            finish();
        });
        dialog.show();
    }

    private void idle() {
        // The single place a parcel is let go of. Every path ends here, which
        // is what makes it safe for busy to be released only here.
        busy = false;
        // Jam menganggur dimulai di sini: sesudah beberapa detik tanpa
        // barcode, tulisannya ikut dibaca.
        menganggurSejak = android.os.SystemClock.uptimeMillis();
        teksMenganggurAt = 0;
        resiTulisan.clear();
        tawaranResiDitolak = false;
        tawaranResiTampil = false;
        pesananDariBarcode = null;
        status.setText("Siap");
        status.setTextColor(Color.parseColor("#6B7178"));
        detail.setVisibility(View.GONE);
        tookBlurred = false;
        collecting = false;
        // Belongs to the parcel just finished with; carrying it into the next
        // one would file this label's codes against the following parcel.
        seenCodes.clear();
        reader.reset();
        // Suara paket sebelumnya yang terbawa akan memilih nomor
        // pesanan milik paket yang salah.
        suara.kosongkan();
        // Alasan yang sama dengan seenCodes di atas: nomor pesanan dan bidikan
        // paket sebelumnya tidak boleh terbawa ke paket berikutnya.
        panduanAktif = false;
        fotoTahap.clear();
        gabunganDipakai = false;
        orderIdFinal = null;
        orderIdSumber = null;
        if (guide != null) guide.setVisibility(View.GONE);
        if (liveRead != null) liveRead.setVisibility(View.GONE);
        hint.setText("Arahkan kamera ke barcode pada resi. Tersimpan otomatis.");
    }

    private void promptManual() {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        input.setHint("Contoh: JX1234567890");
        new MaterialAlertDialogBuilder(this)
                .setTitle("Input Manual")
                .setMessage("Untuk label yang barcodenya rusak atau tidak terbaca.")
                .setView(input)
                .setPositiveButton("Simpan", (d, w) -> {
                    String v = input.getText().toString().trim();
                    if (v.isEmpty()) return;
                    busy = true;
                    // Typed in by hand: no photo and nothing was read, so
                    // there is no reading to carry.
                    submit(ResiExtractor.normalize(v), v, null, null, null);
                })
                .setNegativeButton("Batal", null)
                .show();
    }

    private void mute(String resi) {
        mutedResi = resi;
        mutedUntil = System.currentTimeMillis() + REPEAT_MUTE_MS;
    }

    private void showBanner(boolean ok, String resi, String detailText) {
        bannerText.setText(resi + "\n" + detailText);
        banner.setBackgroundResource(ok ? R.drawable.bg_ok : R.drawable.bg_warn);
        bannerText.setTextColor(Color.parseColor(ok ? "#1B7F4B" : "#B3261E"));
        banner.setVisibility(View.VISIBLE);
        // Only the previous banner's own hide is cancelled. This used to clear
        // EVERY pending main-thread callback, which on the wrong ordering would
        // have taken the clarity poll or the scheduled return-to-ready with it.
        if (hideBanner != null) main.removeCallbacks(hideBanner);
        hideBanner = () -> banner.setVisibility(View.GONE);
        main.postDelayed(hideBanner, ok ? 2200 : 5000);
    }

    /**
     * The only confirmation the packer gets, so the two outcomes must be
     * unmistakable by ear alone: one short beep for recorded, a long error
     * tone plus a stutter of vibration for a parcel that was already done.
     */
    private void feedback(boolean ok) {
        try {
            ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 100);
            tone.startTone(ok ? ToneGenerator.TONE_PROP_BEEP : ToneGenerator.TONE_SUP_ERROR,
                    ok ? 150 : 500);
        } catch (Exception ignored) {}
        try {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(ok
                        ? VibrationEffect.createOneShot(70, VibrationEffect.DEFAULT_AMPLITUDE)
                        : VibrationEffect.createWaveform(new long[]{0, 140, 90, 140, 90, 260}, -1));
            } else {
                v.vibrate(ok ? 70 : 450);
            }
        } catch (Exception ignored) {}
    }

    private void refreshCounter() {
        api.summary(r -> {
            if (!r.ok() || r.data() == null) return;
            int pending = r.data().optInt("ocrPending", 0);
            String s = "Hari ini: " + r.data().optInt("today", 0)
                    + "  -  Total: " + r.data().optInt("total", 0);
            if (pending > 0) s += "  -  " + pending + " label sedang dibaca";
            counter.setText(s);
        });
    }

    private static String formatName(int format) {
        switch (format) {
            case Barcode.FORMAT_CODE_128: return "CODE_128";
            case Barcode.FORMAT_CODE_39: return "CODE_39";
            case Barcode.FORMAT_CODE_93: return "CODE_93";
            case Barcode.FORMAT_CODABAR: return "CODABAR";
            case Barcode.FORMAT_ITF: return "ITF";
            case Barcode.FORMAT_EAN_13: return "EAN_13";
            case Barcode.FORMAT_QR_CODE: return "QR";
            default: return "OTHER";
        }
    }

    private void confirmLogout() {
        new MaterialAlertDialogBuilder(this)
                .setTitle("Keluar")
                .setMessage("Keluar dari akun " + session.email() + "?")
                .setPositiveButton("Keluar", (d, w) -> {
                    session.clear();
                    startActivity(new Intent(this, LoginActivity.class));
                    finish();
                })
                .setNegativeButton("Batal", null)
                .show();
    }

    @Override protected void onResume() {
        super.onResume();
        if (session.loggedIn()) refreshCounter();
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        if (cameraExecutor != null) cameraExecutor.shutdown();
        if (scanner != null) scanner.close();
    }
}

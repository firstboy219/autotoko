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
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
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
    /** The seller's own products, fetched once, matched against on every scan. */
    private final List<ProductMatcher.Product> catalogue = new ArrayList<>();
    /** True between finding the barcode and taking the photo: gather text now. */
    private volatile boolean collecting = false;
    /** One text recognition at a time; they take longer than a frame. */
    private volatile boolean readingText = false;
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
        findViewById(R.id.stock).setOnClickListener(v ->
                startActivity(new Intent(this, StockActivity.class)));
        clarityBar = findViewById(R.id.clarityBar);
        clarityText = findViewById(R.id.clarityText);
        liveRead = findViewById(R.id.liveRead);

        textRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        loadCatalogue();
        banner = findViewById(R.id.banner);
        bannerText = findViewById(R.id.bannerText);

        findViewById(R.id.manual).setOnClickListener(v -> promptManual());
        findViewById(R.id.history).setOnClickListener(v ->
            startActivity(new Intent(this, HistoryActivity.class)));
        findViewById(R.id.logout).setOnClickListener(v -> confirmLogout());

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
            if (d < bestDistance) {
                bestDistance = d;
                best = code;
            }
        }
        if (best == null) return;

        String resi = ResiExtractor.normalize(best.getRawValue());
        if (resi.equals(mutedResi) && System.currentTimeMillis() < mutedUntil) return;

        Rect box = best.getBoundingBox();
        lastBarcodeBox = (box == null || frameWidth <= 0) ? null : new RectF(
                box.left / (float) frameWidth,
                box.top / (float) frameHeight,
                box.right / (float) frameWidth,
                box.bottom / (float) frameHeight);

        mute(resi);
        reader.reset();
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
        main.postDelayed(
                () -> waitForClarity(resi, raw, format, android.os.SystemClock.uptimeMillis()),
                FOCUS_SETTLE_MS);
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
    private static final class Candidate {
        final String rawText;
        final List<ProductMatcher.Match> ranked;
        /** Index into ranked, or -1 for "not one of my products". */
        int chosen = 0;
        double qty = 1;
        EditText qtyField;

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
    private void resolve(String resi, String raw, String format, String photoBase64) {
        collecting = false;
        List<Candidate> candidates = new ArrayList<>();
        boolean unsure = false;

        for (LabelReader.Line line : reader.productLines()) {
            List<ProductMatcher.Match> ranked = ProductMatcher.rank(line.text, catalogue, 5);
            if (ranked.isEmpty()) continue;
            candidates.add(new Candidate(line.text, ranked));
            if (!ranked.get(0).confident) unsure = true;
            if (candidates.size() >= 6) break;
        }

        if (candidates.isEmpty() || !unsure) {
            submit(resi, raw, format, photoBase64, reading(candidates, false));
            return;
        }
        ask(resi, raw, format, photoBase64, candidates);
    }

    /** The sheet shown when the phone will not guess on its own. */
    private void ask(String resi, String raw, String format, String photoBase64,
                     List<Candidate> candidates) {
        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        for (final Candidate c : candidates) {
            TextView label = new TextView(this);
            String shown = c.rawText.length() > 90 ? c.rawText.substring(0, 90) + "…" : c.rawText;
            label.setText("Di resi: " + shown);
            label.setTextSize(11);
            label.setPadding(0, (int) (10 * d), 0, (int) (2 * d));
            root.addView(label);

            List<String> options = new ArrayList<>();
            for (ProductMatcher.Match m : c.ranked) {
                options.add(m.product.name + "  (" + Math.round(m.score * 100) + "%)");
            }
            options.add("— bukan produk saya —");

            Spinner spinner = new Spinner(this);
            spinner.setAdapter(new ArrayAdapter<>(
                    this, android.R.layout.simple_spinner_dropdown_item, options));
            spinner.setSelection(0);
            spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
                @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                    c.chosen = pos < c.ranked.size() ? pos : -1;
                }
                @Override public void onNothingSelected(AdapterView<?> p) {}
            });
            root.addView(spinner);

            EditText qty = new EditText(this);
            qty.setInputType(InputType.TYPE_CLASS_NUMBER);
            qty.setText("1");
            qty.setHint("Jumlah");
            c.qtyField = qty;
            root.addView(qty);
        }

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);

        new AlertDialog.Builder(this)
                .setTitle("Cocokkan isi paket")
                .setView(scroll)
                // Not cancellable by tapping away: the scan is already held
                // open and a dismissed dialog would leave the parcel unsaved
                // with nothing on screen to say so.
                .setCancelable(false)
                .setPositiveButton("Simpan", (dlg, w) -> {
                    for (Candidate c : candidates) {
                        try {
                            double v = Double.parseDouble(c.qtyField.getText().toString().trim());
                            if (v > 0 && v <= 9999) c.qty = v;
                        } catch (Exception ignored) {
                            // Left at 1, which is what almost every parcel holds.
                        }
                    }
                    submit(resi, raw, format, photoBase64, reading(candidates, true));
                })
                .setNegativeButton("Lewati", (dlg, w) ->
                        submit(resi, raw, format, photoBase64, reading(new ArrayList<>(), true)))
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
            String orderNo = reader.orderNo();
            if (orderNo != null) out.put("labelOrderNo", orderNo);

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
                item.put("rawName",
                        c.rawText.length() > 255 ? c.rawText.substring(0, 255) : c.rawText);
                item.put("qty", c.qty);
                item.put("source", confirmed ? "device_confirmed" : "device_auto");
                item.put("matchScore", Math.round(m.score * 1000) / 1000.0);
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
            busy = false;

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
                idle();
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
        new AlertDialog.Builder(this)
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

    private void idle() {
        status.setText("Siap");
        status.setTextColor(Color.parseColor("#6B7178"));
        detail.setVisibility(View.GONE);
        tookBlurred = false;
        collecting = false;
        reader.reset();
        if (liveRead != null) liveRead.setVisibility(View.GONE);
        hint.setText("Arahkan kamera ke barcode pada resi. Tersimpan otomatis.");
    }

    private void promptManual() {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        input.setHint("Contoh: JX1234567890");
        new AlertDialog.Builder(this)
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
        main.removeCallbacksAndMessages(null);
        main.postDelayed(() -> banner.setVisibility(View.GONE), ok ? 2200 : 5000);
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
        new AlertDialog.Builder(this)
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

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
import android.widget.Button;
import android.widget.EditText;
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

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
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

    private PreviewView preview;
    private TextView status, detail, counter, hint;
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

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                ProcessCameraProvider provider = future.get();

                Preview p = new Preview.Builder().build();
                p.setSurfaceProvider(preview.getSurfaceProvider());

                ImageAnalysis analysis = new ImageAnalysis.Builder()
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
        if (analysing || busy) {
            proxy.close();
            return;
        }
        android.media.Image media = proxy.getImage();
        if (media == null) {
            proxy.close();
            return;
        }
        analysing = true;

        int rot = proxy.getImageInfo().getRotationDegrees();
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
        main.postDelayed(() -> capture(resi, raw, format), FOCUS_SETTLE_MS);
    }

    /** Takes the still, then submits. The photo is what the server will read. */
    private void capture(String resi, String raw, String format) {
        busy = true;
        hint.setText("Memotret label...");

        if (imageCapture == null) {
            submit(resi, raw, format, null);
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
                main.post(() -> submit(resi, raw, format, payload));
            }

            @Override public void onError(@NonNull ImageCaptureException e) {
                main.post(() -> submit(resi, raw, format, null));
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

    private void submit(String resi, String raw, String format, String photoBase64) {
        hint.setText("Menyimpan...");
        api.scan(resi, raw, "barcode", format, photoBase64, r -> {
            busy = false;

            if (r.ok()) {
                feedback(true);
                String extra = "Tersimpan";
                if (r.data() != null && r.data().optJSONObject("linkedOrder") != null) {
                    extra = "Tersimpan, order "
                            + r.data().optJSONObject("linkedOrder").optString("marketplaceOrderId")
                            + " jadi Dikirim";
                }
                showBanner(true, resi, extra);
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
                idle();
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

    private void idle() {
        status.setText("Siap");
        status.setTextColor(Color.parseColor("#6B7178"));
        detail.setVisibility(View.GONE);
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
                    submit(ResiExtractor.normalize(v), v, null, null);
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

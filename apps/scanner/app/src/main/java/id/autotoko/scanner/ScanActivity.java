package id.autotoko.scanner;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
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
    /** Longest edge of the uploaded photo. Enough for OCR, small on wifi. */
    private static final int PHOTO_MAX_EDGE = 1600;
    private static final int PHOTO_QUALITY = 78;

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

        // Formats Indonesian courier labels actually print. Restricting the set
        // keeps the detector fast and stops it locking onto unrelated codes.
        scanner = BarcodeScanning.getClient(new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(
                        Barcode.FORMAT_CODE_128,
                        Barcode.FORMAT_CODE_39,
                        Barcode.FORMAT_CODE_93,
                        Barcode.FORMAT_CODABAR,
                        Barcode.FORMAT_ITF,
                        Barcode.FORMAT_EAN_13,
                        Barcode.FORMAT_QR_CODE)
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
                provider.bindToLifecycle(
                        this, CameraSelector.DEFAULT_BACK_CAMERA, p, analysis, imageCapture);
            } catch (Exception e) {
                hint.setText("Kamera tidak bisa dibuka: " + e.getMessage());
            }
        }, ContextCompat.getMainExecutor(this));
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

        InputImage image = InputImage.fromMediaImage(media, proxy.getImageInfo().getRotationDegrees());
        scanner.process(image)
                .addOnSuccessListener(codes -> main.post(() -> onBarcodes(codes)))
                .addOnCompleteListener(t -> {
                    analysing = false;
                    proxy.close();
                });
    }

    private void onBarcodes(List<Barcode> codes) {
        if (busy || codes == null || codes.isEmpty()) return;

        for (Barcode code : codes) {
            String raw = code.getRawValue();
            if (raw == null) continue;
            String resi = ResiExtractor.normalize(raw);
            // A barcode is exact, but labels also carry codes for other things
            // (postal routing, a URL in a QR). Length is the cheap filter.
            if (resi.length() < 8 || resi.length() > 32) continue;
            if (resi.equals(mutedResi) && System.currentTimeMillis() < mutedUntil) return;

            mute(resi);
            capture(resi, raw, formatName(code.getFormat()));
            return;
        }
    }

    /** Takes the still, then submits. The photo is what the server will read. */
    private void capture(String resi, String raw, String format) {
        busy = true;
        status.setText(resi);
        status.setTextColor(Color.parseColor("#1B1D1F"));
        detail.setVisibility(View.GONE);
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

    private String toBase64Jpeg(ImageProxy image) {
        ByteBuffer buffer = image.getPlanes()[0].getBuffer();
        byte[] bytes = new byte[buffer.remaining()];
        buffer.get(bytes);

        Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bmp == null) return null;

        int rotation = image.getImageInfo().getRotationDegrees();
        int w = bmp.getWidth(), h = bmp.getHeight();
        int longest = Math.max(w, h);
        if (longest > PHOTO_MAX_EDGE) {
            float s = (float) PHOTO_MAX_EDGE / longest;
            bmp = Bitmap.createScaledBitmap(bmp, Math.round(w * s), Math.round(h * s), true);
        }
        if (rotation != 0) {
            Matrix m = new Matrix();
            m.postRotate(rotation);
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
        }

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, PHOTO_QUALITY, out);
        bmp.recycle();
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
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

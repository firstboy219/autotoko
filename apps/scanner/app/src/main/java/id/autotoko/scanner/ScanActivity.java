package id.autotoko.scanner;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Camera + on-device OCR, then one tap to record the resi.
 *
 * The scan is never submitted automatically. OCR on a dense shipping label is
 * good but not certain, and because the server refuses a resi it has already
 * seen, an automatic wrong reading does lasting damage: it occupies a key the
 * real parcel may need later, and the packer never sees it happen. A tap costs
 * a moment and keeps a human in the loop for the one decision that matters.
 */
@ExperimentalGetImage
public class ScanActivity extends AppCompatActivity {

    private static final int REQ_CAMERA = 101;
    /** Re-running OCR on every frame burns battery for no extra accuracy. */
    private static final long OCR_INTERVAL_MS = 400;
    /** After saving, ignore the same label for a moment — it is still in frame. */
    private static final long REPEAT_MUTE_MS = 4000;

    private PreviewView preview;
    private TextView detected, courierLabel, hint, banner, counter;
    private Button saveButton;
    private LinearLayout alternatives;

    private Session session;
    private Api api;
    private TextRecognizer recognizer;
    private ExecutorService cameraExecutor;
    private final Handler main = new Handler(Looper.getMainLooper());

    private volatile boolean analysing = false;
    private volatile boolean submitting = false;
    private long lastOcrAt = 0;
    private String currentResi = null;
    private String currentRaw = null;
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
        detected = findViewById(R.id.detected);
        courierLabel = findViewById(R.id.courier);
        hint = findViewById(R.id.hint);
        banner = findViewById(R.id.banner);
        counter = findViewById(R.id.counter);
        saveButton = findViewById(R.id.save);
        alternatives = findViewById(R.id.alternatives);

        saveButton.setOnClickListener(v -> submit(currentResi, currentRaw, "ocr"));
        findViewById(R.id.manual).setOnClickListener(v -> promptManual());
        findViewById(R.id.history).setOnClickListener(v ->
            startActivity(new Intent(this, HistoryActivity.class)));
        findViewById(R.id.logout).setOnClickListener(v -> confirmLogout());

        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        cameraExecutor = Executors.newSingleThreadExecutor();

        setCandidate(null, null, null);
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

                provider.unbindAll();
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, p, analysis);
            } catch (Exception e) {
                hint.setText("Kamera tidak bisa dibuka: " + e.getMessage());
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void analyse(ImageProxy proxy) {
        long now = System.currentTimeMillis();
        if (analysing || submitting || now - lastOcrAt < OCR_INTERVAL_MS) {
            proxy.close();
            return;
        }
        android.media.Image media = proxy.getImage();
        if (media == null) {
            proxy.close();
            return;
        }
        analysing = true;
        lastOcrAt = now;

        InputImage image = InputImage.fromMediaImage(media, proxy.getImageInfo().getRotationDegrees());
        recognizer.process(image)
                .addOnSuccessListener(text -> main.post(() -> onText(text.getText())))
                .addOnCompleteListener(t -> {
                    analysing = false;
                    proxy.close();
                });
    }

    private void onText(String text) {
        if (submitting) return;
        List<ResiExtractor.Candidate> found = ResiExtractor.extract(text);
        if (found.isEmpty()) return;

        ResiExtractor.Candidate best = found.get(0);
        if (best.value.equals(mutedResi) && System.currentTimeMillis() < mutedUntil) return;

        setCandidate(best.value, best.raw, best.courier);
        renderAlternatives(found);
    }

    private void setCandidate(String resi, String raw, String courier) {
        currentResi = resi;
        currentRaw = raw;
        boolean has = resi != null && !resi.isEmpty();
        detected.setText(has ? resi : "—");
        detected.setTextColor(has ? Color.parseColor("#1B1D1F") : Color.parseColor("#6B7178"));
        courierLabel.setText(courier == null ? "" : courier);
        courierLabel.setVisibility(courier == null ? View.GONE : View.VISIBLE);
        saveButton.setEnabled(has);
        saveButton.setAlpha(has ? 1f : 0.45f);
        hint.setText(has
            ? "Periksa nomornya, lalu tekan Simpan."
            : "Arahkan kamera ke nomor resi.");
    }

    private void renderAlternatives(List<ResiExtractor.Candidate> found) {
        alternatives.removeAllViews();
        if (found.size() < 2) {
            findViewById(R.id.alternativesRow).setVisibility(View.GONE);
            return;
        }
        findViewById(R.id.alternativesRow).setVisibility(View.VISIBLE);
        for (int i = 1; i < found.size(); i++) {
            final ResiExtractor.Candidate c = found.get(i);
            Button b = new Button(this);
            b.setText(c.value);
            b.setAllCaps(false);
            b.setTextSize(12);
            b.setBackgroundResource(R.drawable.bg_input);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.rightMargin = 12;
            b.setLayoutParams(lp);
            b.setOnClickListener(v -> setCandidate(c.value, c.raw, c.courier));
            alternatives.addView(b);
        }
    }

    private void promptManual() {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        input.setHint("Contoh: JX1234567890");
        new AlertDialog.Builder(this)
                .setTitle("Input Manual")
                .setMessage("Untuk label yang tidak terbaca kamera.")
                .setView(input)
                .setPositiveButton("Simpan", (d, w) -> {
                    String v = input.getText().toString().trim();
                    if (v.isEmpty()) return;
                    submit(ResiExtractor.normalize(v), v, "manual");
                })
                .setNegativeButton("Batal", null)
                .show();
    }

    private void submit(String resi, String raw, String source) {
        if (resi == null || resi.isEmpty() || submitting) return;
        submitting = true;
        saveButton.setEnabled(false);
        saveButton.setText("Menyimpan…");

        api.scan(resi, raw == null ? resi : raw, source, r -> {
            submitting = false;
            saveButton.setText("Simpan");

            if (r.ok()) {
                feedback(true);
                showBanner(true, "TERSIMPAN", resi);
                mute(resi);
                setCandidate(null, null, null);
                refreshCounter();
                return;
            }

            if (r.code == 409 && r.body != null && "DUPLICATE".equals(r.body.optString("code"))) {
                feedback(false);
                String when = Format.humanTime(r.body.optString("firstScannedAt", null));
                String device = r.body.optString("deviceLabel", "");
                StringBuilder sb = new StringBuilder("Sudah discan");
                if (when != null) sb.append(" ").append(when);
                if (device != null && !device.isEmpty() && !"null".equals(device)) {
                    sb.append(" • ").append(device);
                }
                showBanner(false, "SUDAH PERNAH DISCAN", resi + "\n" + sb);
                mute(resi);
                setCandidate(null, null, null);
                return;
            }

            if (r.code == 401) {
                Toast.makeText(this, "Sesi berakhir. Silakan masuk lagi.", Toast.LENGTH_LONG).show();
                session.clear();
                startActivity(new Intent(this, LoginActivity.class));
                finish();
                return;
            }

            feedback(false);
            showBanner(false, "GAGAL", r.message("Tidak bisa menyimpan (kode " + r.code + ")."));
            saveButton.setEnabled(currentResi != null);
        });
    }

    private void mute(String resi) {
        mutedResi = resi;
        mutedUntil = System.currentTimeMillis() + REPEAT_MUTE_MS;
    }

    private void showBanner(boolean ok, String title, String detail) {
        banner.setText(title + "\n" + detail);
        banner.setBackgroundResource(ok ? R.drawable.bg_ok : R.drawable.bg_warn);
        banner.setTextColor(Color.parseColor(ok ? "#1B7F4B" : "#B3261E"));
        banner.setVisibility(View.VISIBLE);
        main.removeCallbacksAndMessages(null);
        main.postDelayed(() -> banner.setVisibility(View.GONE), ok ? 2500 : 6000);
    }

    /**
     * Sound and vibration, because a packer is looking at the parcel and not
     * at the phone. A duplicate gets a distinctly harsher pattern than a save
     * so the two are never confused by feel alone.
     */
    private void feedback(boolean ok) {
        try {
            ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 90);
            tone.startTone(ok ? ToneGenerator.TONE_PROP_BEEP : ToneGenerator.TONE_SUP_ERROR, ok ? 120 : 400);
        } catch (Exception ignored) {}
        try {
            Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(ok
                        ? VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE)
                        : VibrationEffect.createWaveform(new long[]{0, 120, 90, 120, 90, 220}, -1));
            } else {
                v.vibrate(ok ? 60 : 400);
            }
        } catch (Exception ignored) {}
    }

    private void refreshCounter() {
        api.summary(r -> {
            if (!r.ok() || r.data() == null) return;
            counter.setText("Hari ini: " + r.data().optInt("today", 0)
                    + "  •  Total: " + r.data().optInt("total", 0));
        });
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
        if (recognizer != null) recognizer.close();
    }
}

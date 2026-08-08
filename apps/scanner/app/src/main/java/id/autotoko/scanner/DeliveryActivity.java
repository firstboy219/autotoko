package id.autotoko.scanner;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.os.Bundle;
import android.text.InputType;
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
    private static final int PHOTO_MAX_EDGE = 1600;
    private static final int PHOTO_QUALITY = 80;

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

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        session = new Session(this);
        api = new Api(session);
        cameraExecutor = Executors.newSingleThreadExecutor();
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        barcodes = BarcodeScanning.getClient(new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39)
                .build());

        setContentView(R.layout.activity_delivery);
        preview = findViewById(R.id.dlPreview);
        status = findViewById(R.id.dlStatus);
        hint = findViewById(R.id.dlHint);
        read = findViewById(R.id.dlRead);
        findViewById(R.id.dlClose).setOnClickListener(v -> finish());
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
                provider.bindToLifecycle(
                        this, CameraSelector.DEFAULT_BACK_CAMERA, p, analysis, imageCapture);
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
                        collector.addFrame(t.getText());
                        main.post(this::renderRead);
                    })
                    .addOnCompleteListener(t -> readingText = false);
        }

        if (busy) {
            proxy.close();
            return;
        }
        analysing = true;
        barcodes.process(InputImage.fromMediaImage(media, rot))
                .addOnSuccessListener(codes -> main.post(() -> onBarcodes(codes)))
                .addOnCompleteListener(t -> {
                    analysing = false;
                    proxy.close();
                });
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

    private void onBarcodes(List<Barcode> codes) {
        if (busy || codes == null || codes.isEmpty()) return;
        for (Barcode c : codes) {
            String raw = c.getRawValue();
            if (raw == null) continue;
            String resi = ResiExtractor.normalize(raw);
            if (resi.length() < 6 || resi.length() > 32) continue;
            busy = true;
            status.setText(resi);
            hint.setText("Memotret resi...");
            capture(resi);
            return;
        }
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
                main.post(() -> map(resi, payload));
            }

            @Override public void onError(@NonNull ImageCaptureException e) {
                main.post(() -> map(resi, null));
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

    /** One mapped line: which material, how many packages, how much in each. */
    private static final class Row {
        final String rawName;
        final List<ProductMatcher.Product> options;
        int chosen = 0;
        EditText pcsField;
        EditText contentField;
        TextView unitLabel;

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

        final LinearLayout rowsBox = new LinearLayout(this);
        rowsBox.setOrientation(LinearLayout.VERTICAL);
        root.addView(rowsBox);

        for (String line : collector.lines()) {
            List<ProductMatcher.Match> ranked = ProductMatcher.rank(line, catalogue, 5);
            if (ranked.isEmpty()) continue;
            List<ProductMatcher.Product> opts = new ArrayList<>();
            for (ProductMatcher.Match m : ranked) opts.add(m.product);
            addRow(rowsBox, rows, line, opts, d);
            if (rows.size() >= 8) break;
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

        final EditText codAmount = new EditText(this);
        codAmount.setInputType(InputType.TYPE_CLASS_NUMBER);
        codAmount.setHint("Nominal COD (Rp)");
        codAmount.setVisibility(View.GONE);
        root.addView(codAmount);

        final TextView codNote = new TextView(this);
        codNote.setTextSize(11);
        codNote.setTextColor(Color.parseColor("#6B7178"));
        codNote.setVisibility(View.GONE);
        root.addView(codNote);

        cod.setOnCheckedChangeListener((v, checked) -> {
            codAmount.setVisibility(checked ? View.VISIBLE : View.GONE);
            codNote.setVisibility(checked ? View.VISIBLE : View.GONE);
            // Said plainly, because it decides whether HPP learns anything from
            // this delivery: one material means the amount IS its price.
            codNote.setText(rows.size() == 1
                    ? "Nominal ini jadi harga bahan tersebut."
                    : "Resi berisi beberapa bahan — nominal dicatat sebagai total, "
                      + "harga rata-rata tiap bahan tidak diubah.");
        });

        ScrollView sv = new ScrollView(this);
        sv.addView(root);

        new MaterialAlertDialogBuilder(this)
                .setTitle("Bahan Datang — " + resi)
                .setView(sv)
                .setCancelable(false)
                .setPositiveButton("Simpan", (d2, w) -> {
                    boolean isCod = cod.isChecked();
                    double amount = parse(codAmount, 0);
                    if (isCod && amount <= 0) {
                        Toast.makeText(this, "Nominal COD wajib diisi.", Toast.LENGTH_LONG).show();
                        // Re-open rather than lose the mapping they just did.
                        map(resi, photoBase64);
                        return;
                    }
                    submit(resi, photoBase64, rows, isCod, amount);
                })
                .setNegativeButton("Batal", (d2, w) -> reset())
                .show();
    }

    private void addRow(LinearLayout box, List<Row> rows, String rawName,
                        List<ProductMatcher.Product> options, float d) {
        final Row row = new Row(rawName, new ArrayList<>(options));
        rows.add(row);

        if (rawName != null) {
            TextView label = new TextView(this);
            label.setText("Di resi: " + (rawName.length() > 70 ? rawName.substring(0, 70) + "…" : rawName));
            label.setTextSize(11);
            label.setTextColor(Color.parseColor("#6B7178"));
            label.setPadding(0, (int) (10 * d), 0, 0);
            box.addView(label);
        }

        List<String> names = new ArrayList<>();
        for (ProductMatcher.Product p : row.options) names.add(p.name);
        Spinner sp = new Spinner(this);
        sp.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names));
        sp.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                row.chosen = pos;
                if (row.unitLabel != null) row.unitLabel.setText(unitOf(row));
            }
            @Override public void onNothingSelected(AdapterView<?> p) {}
        });
        box.addView(sp);

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

        TextView unit = new TextView(this);
        unit.setText(unitOf(row));
        unit.setTextSize(12);
        unit.setPadding((int) (6 * d), 0, 0, 0);
        row.unitLabel = unit;
        qtyRow.addView(unit);

        box.addView(qtyRow);
    }

    private String unitOf(Row row) {
        if (row.chosen < 0 || row.chosen >= row.options.size()) return "";
        String u = units.get(row.options.get(row.chosen).id);
        return u == null || u.isEmpty() ? "" : u;
    }

    private void submit(String resi, String photoBase64, List<Row> rows,
                        boolean isCod, double codAmount) {
        JSONArray items = new JSONArray();
        for (Row r : rows) {
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
                items.put(o);
            } catch (Exception ignored) {}
        }
        if (items.length() == 0) {
            Toast.makeText(this, "Belum ada bahan yang diisi jumlahnya.", Toast.LENGTH_LONG).show();
            reset();
            return;
        }

        hint.setText("Menyimpan...");
        api.recordDelivery(resi, photoBase64, collector.lines().toString(), items,
                isCod, isCod ? codAmount : -1, r -> {
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
                        shareCod(resi, codAmount, contents.toString());
                        reset();
                    });
                }
                done.show();
                return;
            }
            if (r.code == 409) {
                Toast.makeText(this, "Resi ini sudah pernah dilaporkan.", Toast.LENGTH_LONG).show();
            } else {
                Toast.makeText(this, r.message("Gagal menyimpan laporan."), Toast.LENGTH_LONG).show();
            }
            reset();
        });
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

    private void reset() {
        busy = false;
        collector.reset();
        status.setText("Siap");
        hint.setText("Arahkan ke barcode resi bahan baku yang datang.");
        read.setVisibility(View.GONE);
    }
}

package id.autotoko.scanner;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.Spinner;
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

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Point the camera at a label and turn what it says into master data.
 *
 * Typing a product name into a phone in a warehouse is the slowest part of
 * setting the catalogue up, and it is the reason aliases go unfilled — the
 * marketplace listing title is forty characters of marketing that nobody wants
 * to retype. Reading it off the packaging costs a second.
 *
 * Three things can be made from one line, because they are the three that were
 * asked for and because the source is the same in each case: a new product, an
 * extra name for a product that already exists, or a raw material. The line is
 * always editable before it is saved — OCR is a starting point and the
 * catalogue is not somewhere to put a guess.
 */
public class TextScanActivity extends AppCompatActivity {

    private static final int REQ_CAMERA = 102;

    /** Text needs resolution; CameraX defaults to about 640x480. See ScanActivity. */
    private static final android.util.Size ANALYSIS_SIZE = new android.util.Size(1920, 1080);

    private PreviewView preview;
    private TextView status;
    private ListView list;
    private Button freeze;

    private Session session;
    private Api api;
    private TextRecognizer recognizer;
    private ExecutorService cameraExecutor;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());

    private final TextCollector collector = new TextCollector();
    private final List<ProductMatcher.Product> catalogue = new ArrayList<>();
    /** Product id -> its current alias block, so a new alias can be appended. */
    private final Map<String, String> aliases = new HashMap<>();
    private final List<String> shown = new ArrayList<>();

    private volatile boolean reading = false;
    private volatile boolean frozen = false;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        session = new Session(this);
        api = new Api(session);
        cameraExecutor = Executors.newSingleThreadExecutor();
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);

        setContentView(R.layout.activity_textscan);
        preview = findViewById(R.id.tsPreview);
        status = findViewById(R.id.tsStatus);
        list = findViewById(R.id.tsList);
        freeze = findViewById(R.id.tsFreeze);

        findViewById(R.id.tsClose).setOnClickListener(v -> finish());
        freeze.setOnClickListener(v -> {
            frozen = !frozen;
            freeze.setText(frozen ? "Lanjut Baca" : "Bekukan");
            render();
        });
        list.setOnItemClickListener((AdapterView<?> p, View v, int pos, long id) -> {
            if (pos >= 0 && pos < shown.size()) offer(shown.get(pos));
        });

        loadCatalogue();

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
            status.setText("Izin kamera ditolak.");
        }
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        if (cameraExecutor != null) cameraExecutor.shutdown();
    }

    private void loadCatalogue() {
        api.products(r -> {
            if (!r.ok() || r.body == null) return;
            JSONArray arr = r.body.optJSONArray("data");
            if (arr == null) return;
            catalogue.clear();
            aliases.clear();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String id = o.optString("id", "");
                if (id.isEmpty()) continue;
                String alias = o.optString("marketplaceAliases", "");
                catalogue.add(new ProductMatcher.Product(
                        id, o.optString("name", ""), o.optString("sku", ""), alias));
                aliases.put(id, "null".equals(alias) ? "" : alias);
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

                provider.unbindAll();
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, p, analysis);
            } catch (Exception e) {
                status.setText("Kamera tidak bisa dibuka: " + e.getMessage());
            }
        }, ContextCompat.getMainExecutor(this));
    }

    @ExperimentalGetImage
    private void analyse(ImageProxy proxy) {
        // Frozen means the packer is reading the list and choosing. Carrying on
        // would reshuffle the rows under their finger.
        if (reading || frozen) {
            proxy.close();
            return;
        }
        android.media.Image media = proxy.getImage();
        if (media == null) {
            proxy.close();
            return;
        }
        reading = true;
        recognizer.process(InputImage.fromMediaImage(media, proxy.getImageInfo().getRotationDegrees()))
                .addOnSuccessListener(t -> {
                    collector.addFrame(t.getText());
                    main.post(this::render);
                })
                .addOnCompleteListener(t -> {
                    reading = false;
                    proxy.close();
                });
    }

    private void render() {
        shown.clear();
        shown.addAll(collector.lines());
        status.setText(shown.isEmpty()
                ? "Arahkan ke tulisan pada kemasan…  (" + collector.frames() + " frame)"
                : (frozen ? "Dibekukan — ketuk baris untuk menyimpan"
                          : "Ketuk baris untuk menyimpan  (" + collector.frames() + " frame)"));
        list.setAdapter(new ArrayAdapter<>(
                this, android.R.layout.simple_list_item_1, new ArrayList<>(shown)));
    }

    /** What can be made from one line of text. */
    private void offer(String line) {
        frozen = true;
        freeze.setText("Lanjut Baca");

        final EditText text = new EditText(this);
        text.setText(line);
        text.setSelection(line.length());
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad, pad, 0);
        TextView hint = new TextView(this);
        hint.setText("Perbaiki dulu kalau ada huruf yang salah baca.");
        hint.setTextSize(11);
        box.addView(hint);
        box.addView(text);

        new AlertDialog.Builder(this)
                .setTitle("Simpan sebagai")
                .setView(box)
                .setPositiveButton("Produk Baru", (d, w) -> askProduct(text.getText().toString().trim()))
                .setNeutralButton("Alias Produk", (d, w) -> askAlias(text.getText().toString().trim()))
                .setNegativeButton("Bahan Baku", (d, w) -> askMaterial(text.getText().toString().trim()))
                .show();
    }

    /**
     * A SKU nobody has to think about.
     *
     * The master product form demands one and a seller reading a jar off a
     * shelf does not have a code in mind. Derived from the name so it is at
     * least recognisable, with four random characters because two products can
     * legitimately start with the same twelve letters and a collision would be
     * refused by the unique index at the worst possible moment.
     */
    static String suggestSku(String name) {
        String base = name.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
        if (base.length() > 12) base = base.substring(0, 12);
        if (base.isEmpty()) base = "PROD";
        final String chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        Random r = new Random();
        StringBuilder tail = new StringBuilder();
        for (int i = 0; i < 4; i++) tail.append(chars.charAt(r.nextInt(chars.length())));
        return base + "-" + tail;
    }

    private void askProduct(String name) {
        if (name.isEmpty()) return;
        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad, pad, 0);

        EditText nm = new EditText(this);
        nm.setText(name);
        nm.setHint("Nama produk");
        box.addView(label("Nama produk"));
        box.addView(nm);

        EditText sku = new EditText(this);
        sku.setText(suggestSku(name));
        box.addView(label("SKU"));
        box.addView(sku);

        EditText price = new EditText(this);
        price.setInputType(InputType.TYPE_CLASS_NUMBER);
        price.setHint("kosongkan kalau belum tahu");
        box.addView(label("Harga jual (opsional)"));
        box.addView(price);

        ScrollView sv = new ScrollView(this);
        sv.addView(box);

        new AlertDialog.Builder(this)
                .setTitle("Produk Baru")
                .setView(sv)
                .setPositiveButton("Simpan", (dl, w) -> {
                    String n = nm.getText().toString().trim();
                    String s = sku.getText().toString().trim();
                    if (n.isEmpty() || s.isEmpty()) {
                        Toast.makeText(this, "Nama dan SKU wajib diisi.", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    api.createProduct(n, s, price.getText().toString().trim(), r -> {
                        if (r.ok()) {
                            Toast.makeText(this, "Produk \"" + n + "\" ditambahkan.", Toast.LENGTH_LONG).show();
                            loadCatalogue();
                        } else {
                            Toast.makeText(this, r.message("Gagal menyimpan produk."), Toast.LENGTH_LONG).show();
                        }
                    });
                })
                .setNegativeButton("Batal", null)
                .show();
    }

    /**
     * Add this wording as another name for a product that already exists.
     *
     * The candidate list is ordered by how well the text matches, so the right
     * product is usually already at the top — which is the whole reason this is
     * quicker than typing. It is still a list and not an automatic choice:
     * writing an alias onto the wrong product would silently teach the scanner
     * to mis-map every future parcel.
     */
    private void askAlias(String line) {
        if (line.isEmpty()) return;
        if (catalogue.isEmpty()) {
            Toast.makeText(this, "Master produk belum termuat.", Toast.LENGTH_SHORT).show();
            return;
        }
        final List<ProductMatcher.Product> order = new ArrayList<>();
        for (ProductMatcher.Match m : ProductMatcher.rank(line, catalogue, catalogue.size())) {
            order.add(m.product);
        }
        for (ProductMatcher.Product p : catalogue) if (!order.contains(p)) order.add(p);

        List<String> names = new ArrayList<>();
        for (ProductMatcher.Product p : order) names.add(p.name);

        final Spinner sp = new Spinner(this);
        sp.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names));

        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad, pad, 0);
        box.addView(label("Alias: " + line));
        box.addView(label("Tambahkan ke produk"));
        box.addView(sp);

        new AlertDialog.Builder(this)
                .setTitle("Jadikan Alias")
                .setView(box)
                .setPositiveButton("Simpan", (d, w) -> {
                    int pos = sp.getSelectedItemPosition();
                    if (pos < 0 || pos >= order.size()) return;
                    ProductMatcher.Product target = order.get(pos);
                    String current = aliases.get(target.id);
                    if (current == null) current = "";
                    if (current.toLowerCase(Locale.ROOT).contains(line.toLowerCase(Locale.ROOT))) {
                        Toast.makeText(this, "Alias itu sudah ada.", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    // Appended, never replaced: a product collects the several
                    // titles it is listed under, and overwriting would throw
                    // away the ones added before.
                    String next = current.trim().isEmpty() ? line : current.trim() + "\n" + line;
                    api.setProductAliases(target.id, next, r -> {
                        if (r.ok()) {
                            aliases.put(target.id, next);
                            Toast.makeText(this, "Alias ditambahkan ke " + target.name,
                                    Toast.LENGTH_LONG).show();
                            loadCatalogue();
                        } else {
                            Toast.makeText(this, r.message("Gagal menyimpan alias."),
                                    Toast.LENGTH_LONG).show();
                        }
                    });
                })
                .setNegativeButton("Batal", null)
                .show();
    }

    private void askMaterial(String name) {
        if (name.isEmpty()) return;
        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (16 * d);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad, pad, 0);

        EditText nm = new EditText(this);
        nm.setText(name);
        box.addView(label("Nama bahan"));
        box.addView(nm);

        EditText unit = new EditText(this);
        unit.setHint("pcs / kg / roll");
        box.addView(label("Satuan (opsional)"));
        box.addView(unit);

        EditText cost = new EditText(this);
        cost.setInputType(InputType.TYPE_CLASS_NUMBER);
        cost.setHint("kosongkan kalau belum tahu");
        box.addView(label("Harga satuan (opsional)"));
        box.addView(cost);

        ScrollView sv = new ScrollView(this);
        sv.addView(box);

        new AlertDialog.Builder(this)
                .setTitle("Bahan Baku")
                .setView(sv)
                .setPositiveButton("Simpan", (dl, w) -> {
                    String n = nm.getText().toString().trim();
                    if (n.isEmpty()) return;
                    api.createMaterial(n, unit.getText().toString().trim(),
                            cost.getText().toString().trim(), r -> {
                                if (!r.ok()) {
                                    Toast.makeText(this, r.message("Gagal menyimpan bahan."),
                                            Toast.LENGTH_LONG).show();
                                    return;
                                }
                                boolean created = r.data() != null && r.data().optBoolean("created", true);
                                Toast.makeText(this,
                                        created ? "Bahan \"" + n + "\" ditambahkan."
                                                : "\"" + n + "\" sudah ada — yang lama yang dipakai.",
                                        Toast.LENGTH_LONG).show();
                            });
                })
                .setNegativeButton("Batal", null)
                .show();
    }

    private TextView label(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(11);
        t.setTextColor(Color.parseColor("#6B7178"));
        t.setPadding(0, (int) (10 * getResources().getDisplayMetrics().density), 0, 0);
        t.setGravity(Gravity.START);
        t.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return t;
    }
}

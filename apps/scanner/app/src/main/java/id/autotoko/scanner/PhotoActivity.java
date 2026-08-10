package id.autotoko.scanner;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The label photograph, full screen and zoomable.
 *
 * Opened from the edit sheets so a packer can check what the box actually said
 * while correcting what was recorded. That is the whole job: the correction is
 * being made from memory otherwise, several parcels later.
 */
public class PhotoActivity extends AppCompatActivity {

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";

    private static final ExecutorService POOL = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    /**
     * Longest edge to decode to.
     *
     * A label photo off this app is around 12 megapixels; decoded whole that is
     * roughly 48 MB of bitmap and an out-of-memory crash on the cheap handsets
     * this runs on. Two thousand pixels is more than a 1080-wide screen can
     * show at once, so there is still real detail to zoom into.
     */
    private static final int MAX_EDGE = 2048;

    private ZoomableImageView image;
    private TextView status;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_photo);

        image = findViewById(R.id.photo);
        status = findViewById(R.id.photoStatus);
        findViewById(R.id.back).setOnClickListener(v -> finish());

        String title = getIntent().getStringExtra(EXTRA_TITLE);
        ((TextView) findViewById(R.id.header)).setText(title == null ? "Foto Resi" : title);

        String url = getIntent().getStringExtra(EXTRA_URL);
        if (url == null || url.isEmpty()) {
            status.setText("Scan ini tidak punya foto.");
            return;
        }
        load(url.startsWith("http") ? url : new Session(this).baseUrl() + url);
    }

    private void load(String url) {
        status.setText("Memuat foto…");
        POOL.execute(() -> {
            Bitmap bmp = null;
            String error = null;
            try {
                // Two passes: measure, then decode at a size that fits in
                // memory. Decoding once and scaling afterwards is what runs the
                // handset out of heap before it can scale anything.
                BitmapFactory.Options probe = new BitmapFactory.Options();
                probe.inJustDecodeBounds = true;
                try (InputStream in = open(url)) {
                    BitmapFactory.decodeStream(in, null, probe);
                }

                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inSampleSize = sampleSize(probe.outWidth, probe.outHeight);
                try (InputStream in = open(url)) {
                    bmp = BitmapFactory.decodeStream(in, null, opts);
                }
                if (bmp == null) error = "Foto tidak bisa dibaca.";
            } catch (Exception e) {
                error = "Gagal memuat foto. Periksa koneksi.";
            }

            final Bitmap done = bmp;
            final String err = error;
            MAIN.post(() -> {
                if (isFinishing() || isDestroyed()) return;
                if (done == null) {
                    status.setText(err == null ? "Gagal memuat foto." : err);
                    return;
                }
                status.setVisibility(View.GONE);
                image.setImageBitmap(done);
                image.fitToView();
            });
        });
    }

    private InputStream open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        // The uploads route is public, so no token is attached. If that ever
        // changes this is the one place that has to learn about it.
        c.connect();
        return c.getInputStream();
    }

    /** Power of two that brings the longest edge under MAX_EDGE. */
    private static int sampleSize(int w, int h) {
        int longest = Math.max(w, h);
        int sample = 1;
        while (longest / sample > MAX_EDGE) sample *= 2;
        return sample;
    }
}

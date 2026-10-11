package id.autotoko.scanner;

import android.os.Bundle;
import android.view.MenuItem;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;

/**
 * Buka halaman Master Produk & HPP (web) untuk satu produk, di dalam WebView
 * dengan sesi diserahkan via fragment (#t=<jwt>&embed=1) — sama seperti dashboard.
 * Dibuka dari chip "harga != master" di halaman Order; `?beda=1` memunculkan
 * himbauan "Terapkan harga ke semua" di halaman HPP.
 */
public class MasterProdukWebActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle("Master Produk & HPP");
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        }
        String productId = getIntent().getStringExtra("productId");
        WebView wv = new WebView(this);
        WebSettings ws = wv.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        wv.setWebViewClient(new WebViewClient());
        setContentView(wv);

        Session s = new Session(this);
        String base = s.baseUrl();
        String tok = s.token();
        String path =
                (productId != null && !productId.isEmpty()) ? "/hpp/" + productId + "?beda=1" : "/hpp";
        wv.loadUrl(base + path + "#t=" + (tok == null ? "" : tok) + "&embed=1");
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == android.R.id.home) {
            finish();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }
}

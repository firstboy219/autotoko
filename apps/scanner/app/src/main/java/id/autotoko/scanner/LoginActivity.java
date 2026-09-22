package id.autotoko.scanner;

import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

public class LoginActivity extends AppCompatActivity {

    private EditText serverInput, emailInput, passwordInput, deviceInput;
    private Button submit;
    private TextView error, savedHeader;
    private LinearLayout accountsBox;
    private Session session;
    private Api api;
    private boolean busy = false;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        session = new Session(this);
        api = new Api(session);

        // Mode "Tambah akun": jangan lompat ke Dashboard walau ada sesi aktif.
        if (session.loggedIn() && !getIntent().getBooleanExtra("add_account", false)) {
            startActivity(new Intent(this, DashboardActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_login);
        serverInput = findViewById(R.id.server);
        emailInput = findViewById(R.id.email);
        passwordInput = findViewById(R.id.password);
        deviceInput = findViewById(R.id.device);
        submit = findViewById(R.id.submit);
        error = findViewById(R.id.error);
        savedHeader = findViewById(R.id.savedHeader);
        accountsBox = findViewById(R.id.accounts);

        serverInput.setText(session.baseUrl());
        emailInput.setText(session.email());
        deviceInput.setText(session.device());

        submit.setOnClickListener(v -> attempt());
        renderAccounts();
    }

    /** Baris akun tersimpan: ketuk untuk masuk, tombol silang untuk hapus. */
    private void renderAccounts() {
        accountsBox.removeAllViews();
        final float d = getResources().getDisplayMetrics().density;
        JSONArray accs = session.accountsRaw();
        int shown = 0;
        for (int i = 0; i < accs.length(); i++) {
            final JSONObject o = accs.optJSONObject(i);
            if (o == null) continue;
            final String em = o.optString("email", "");
            if (em.isEmpty()) continue;
            final String base = o.optString("base", Session.DEFAULT_BASE);
            shown++;

            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setBackgroundResource(R.drawable.bg_input);
            row.setPadding((int)(14*d), (int)(12*d), (int)(6*d), (int)(12*d));
            LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            rlp.bottomMargin = (int)(8*d);
            row.setLayoutParams(rlp);

            TextView t = new TextView(this);
            t.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            boolean adaSandi = session.passwordFor(em) != null;
            t.setText(adaSandi ? em : (em + "  ·  ketik sandi"));
            t.setTextSize(15);
            t.setTextColor(0xFF1E1E1E);
            row.addView(t);

            TextView x = new TextView(this);
            x.setText("\u2715");
            x.setTextSize(15);
            x.setTextColor(0xFF9A9A9A);
            x.setPadding((int)(12*d), (int)(6*d), (int)(8*d), (int)(6*d));
            x.setOnClickListener(v -> {
                session.removeAccount(em);
                renderAccounts();
            });
            row.addView(x);

            row.setOnClickListener(v -> pickAccount(base, em));
            accountsBox.addView(row);
        }
        boolean any = shown > 0;
        savedHeader.setVisibility(any ? View.VISIBLE : View.GONE);
        accountsBox.setVisibility(any ? View.VISIBLE : View.GONE);
    }

    private void pickAccount(String base, String email) {
        if (busy) return;
        String pwd = session.passwordFor(email);
        serverInput.setText(base);
        emailInput.setText(email);
        if (pwd == null || pwd.isEmpty()) {
            // Akun lama tanpa sandi tersimpan: cukup isi email, minta sandi.
            passwordInput.setText("");
            passwordInput.requestFocus();
            Toast.makeText(this, "Masukkan password untuk " + email, Toast.LENGTH_SHORT).show();
            return;
        }
        passwordInput.setText(pwd);
        doLogin(base, email, pwd, true);
    }

    private void attempt() {
        String base = serverInput.getText().toString().trim().replaceAll("/+$", "");
        String email = emailInput.getText().toString().trim();
        String pass = passwordInput.getText().toString();

        if (base.isEmpty() || email.isEmpty() || pass.isEmpty()) {
            show("Alamat server, email dan password wajib diisi.");
            return;
        }
        doLogin(base, email, pass, false);
    }

    private void doLogin(final String base, final String email, final String pass, final boolean silent) {
        error.setVisibility(View.GONE);
        setBusy(true);
        final String device = deviceInput.getText().toString().trim();
        api.login(base, email, pass, r -> {
            setBusy(false);
            if (!r.ok()) {
                // Sandi tersimpan ternyata ditolak (mis. diganti di web):
                // lupakan sandinya supaya ketukan berikutnya minta ketik lagi.
                if (silent && r.code == 401) {
                    session.clearPassword(email);
                    renderAccounts();
                }
                // 401 di sini = kredensial salah; kode lain ditampilkan apa
                // adanya supaya alamat server yang keliru tidak menyamar
                // sebagai sandi salah.
                show(r.code == 401
                    ? "Email atau password salah."
                    : r.message("Gagal masuk (kode " + r.code + ")."));
                return;
            }
            String token = r.data() == null ? null : r.data().optString("accessToken", null);
            if (token == null || token.isEmpty()) {
                show("Server tidak mengembalikan token. Cek alamat server.");
                return;
            }
            session.save(base, token, email, pass);
            if (!device.isEmpty()) session.setDevice(device);
            startActivity(new Intent(this, DashboardActivity.class));
            finish();
        });
    }

    private void setBusy(boolean b) {
        busy = b;
        submit.setEnabled(!b);
        submit.setText(b ? "Memproses\u2026" : "Masuk");
    }

    private void show(String msg) {
        error.setText(msg);
        error.setVisibility(View.VISIBLE);
    }
}

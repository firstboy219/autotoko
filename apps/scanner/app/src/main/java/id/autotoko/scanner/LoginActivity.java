package id.autotoko.scanner;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

public class LoginActivity extends AppCompatActivity {

    private EditText serverInput, emailInput, passwordInput, deviceInput;
    private Button submit;
    private TextView error;
    private Session session;
    private Api api;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        session = new Session(this);
        api = new Api(session);

        if (session.loggedIn()) {
            startActivity(new Intent(this, ScanActivity.class));
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

        serverInput.setText(session.baseUrl());
        emailInput.setText(session.email());
        deviceInput.setText(session.device());

        submit.setOnClickListener(v -> attempt());
    }

    private void attempt() {
        String base = serverInput.getText().toString().trim().replaceAll("/+$", "");
        String email = emailInput.getText().toString().trim();
        String pass = passwordInput.getText().toString();
        String device = deviceInput.getText().toString().trim();

        if (base.isEmpty() || email.isEmpty() || pass.isEmpty()) {
            show("Alamat server, email dan password wajib diisi.");
            return;
        }

        setBusy(true);
        api.login(base, email, pass, r -> {
            setBusy(false);
            if (!r.ok()) {
                // 401 here is the ordinary "wrong password" case; anything
                // else is worth showing verbatim so a misconfigured server
                // address does not masquerade as bad credentials.
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
            session.save(base, token, email);
            if (!device.isEmpty()) session.setDevice(device);
            startActivity(new Intent(this, ScanActivity.class));
            finish();
        });
    }

    private void setBusy(boolean busy) {
        submit.setEnabled(!busy);
        submit.setText(busy ? "Memproses…" : "Masuk");
    }

    private void show(String msg) {
        error.setText(msg);
        error.setVisibility(View.VISIBLE);
    }
}

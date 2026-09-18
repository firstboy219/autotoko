package id.autotoko.scanner;

import android.app.Activity;
import android.content.Intent;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import org.json.JSONArray;
import org.json.JSONObject;

/** Dialog Akun: ganti akun tersimpan, tambah akun, atau keluar (logout). */
final class AccountSwitcher {
    private AccountSwitcher() {}

    static void show(final Activity act, final Session ses) {
        final float d = act.getResources().getDisplayMetrics().density;
        final int pad = (int) (16 * d);
        final LinearLayout col = new LinearLayout(act);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(pad, pad, pad, pad / 2);

        final TextView cur = new TextView(act);
        String who = ses.email();
        cur.setText("Akun aktif: " + (who == null || who.isEmpty() ? "-" : who));
        cur.setTextSize(14);
        col.addView(cur);

        final androidx.appcompat.app.AlertDialog dlg =
                new MaterialAlertDialogBuilder(act).setTitle("Akun").setView(col)
                        .setNegativeButton("Tutup", null).create();

        final TextView lbl = new TextView(act);
        lbl.setText("Ganti ke akun lain:");
        lbl.setTextSize(12);
        lbl.setPadding(0, (int) (10 * d), 0, 0);
        col.addView(lbl);

        JSONArray accs = ses.accountsRaw();
        boolean adaLain = false;
        for (int i = 0; i < accs.length(); i++) {
            JSONObject o = accs.optJSONObject(i);
            if (o == null) continue;
            final String em = o.optString("email", "");
            if (em.isEmpty() || em.equalsIgnoreCase(who)) continue;
            adaLain = true;
            Button b = new Button(act);
            b.setAllCaps(false);
            b.setText("Masuk sebagai " + em);
            b.setOnClickListener(v -> {
                if (ses.switchTo(em)) {
                    Access.lupakan();
                    dlg.dismiss();
                    restart(act, DashboardActivity.class);
                }
            });
            col.addView(b);
        }
        if (!adaLain) {
            TextView none = new TextView(act);
            none.setText("Belum ada akun lain tersimpan.");
            none.setTextColor(0xFF8A8A8A);
            col.addView(none);
        }

        Button add = new Button(act);
        add.setAllCaps(false);
        add.setText("+ Tambah akun");
        add.setOnClickListener(v -> {
            dlg.dismiss();
            Intent i = new Intent(act, LoginActivity.class);
            i.putExtra("add_account", true);
            act.startActivity(i);
        });
        col.addView(add);

        Button out = new Button(act);
        out.setAllCaps(false);
        out.setText("Keluar (logout)");
        out.setOnClickListener(v -> new MaterialAlertDialogBuilder(act)
                .setTitle("Keluar")
                .setMessage("Keluar dari akun " + (who == null ? "" : who) + "?")
                .setNegativeButton("Batal", null)
                .setPositiveButton("Keluar", (dd, ww) -> {
                    ses.logout();
                    Access.lupakan();
                    dlg.dismiss();
                    restart(act, LoginActivity.class);
                }).show());
        col.addView(out);

        dlg.show();
    }

    private static void restart(Activity act, Class<?> target) {
        Intent i = new Intent(act, target);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        act.startActivity(i);
    }
}

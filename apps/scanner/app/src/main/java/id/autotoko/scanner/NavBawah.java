package id.autotoko.scanner;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Footer navigasi tetap: Home, Pesanan, Packing List, Promotion.
 *
 * Tumpukan layar dijaga dangkal: Home selalu kembali ke Dashboard yang sudah
 * ada (CLEAR_TOP), tab lain dibawa ke depan bila sudah terbuka, dan layar tab
 * yang ditinggalkan ditutup. Tanpa itu, bolak-balik lima kali di footer
 * meninggalkan belasan layar yang harus di-"back" satu per satu.
 */
final class NavBawah {

    private NavBawah() {}

    static final String HOME = "home", PESANAN = "pesanan", PACKING = "packing", PROMO = "promo";

    /** Bungkus konten layar dengan footer; kembalikan view untuk setContentView. */
    static View bungkus(Activity a, View konten, String aktif) {
        float d = a.getResources().getDisplayMetrics().density;
        LinearLayout col = new LinearLayout(a);
        col.setOrientation(LinearLayout.VERTICAL);
        col.addView(konten, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        View garis = new View(a);
        garis.setBackgroundColor(a.getColor(R.color.line));
        col.addView(garis, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, (int) d)));

        LinearLayout bar = new LinearLayout(a);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setBackgroundColor(a.getColor(R.color.surface));
        bar.setPadding(0, (int) (6 * d), 0, (int) (6 * d));
        String[][] item = {
                {HOME, "🏠", "Home"},
                {PESANAN, "📦", "Pesanan"},
                {PACKING, "📋", "Packing List"},
                {PROMO, "🏷️", "Promotion"},
        };
        for (String[] it : item) {
            final String kode = it[0];
            boolean on = kode.equals(aktif);
            LinearLayout sel = new LinearLayout(a);
            sel.setOrientation(LinearLayout.VERTICAL);
            sel.setGravity(Gravity.CENTER_HORIZONTAL);
            sel.setClickable(true);
            sel.setFocusable(true);
            TextView ikon = new TextView(a);
            ikon.setText(it[1]);
            ikon.setTextSize(20);
            ikon.setGravity(Gravity.CENTER);
            ikon.setAlpha(on ? 1f : 0.55f);
            sel.addView(ikon);
            TextView lbl = new TextView(a);
            lbl.setText(it[2]);
            lbl.setTextSize(11);
            lbl.setGravity(Gravity.CENTER);
            lbl.setTextColor(on ? a.getColor(R.color.brand) : a.getColor(R.color.ink2));
            lbl.setTypeface(null, on ? Typeface.BOLD : Typeface.NORMAL);
            sel.addView(lbl);
            // Garis penanda tab aktif di bawah label.
            View tanda = new View(a);
            tanda.setBackgroundColor(on ? a.getColor(R.color.brand) : Color.TRANSPARENT);
            LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams((int) (24 * d), (int) (3 * d));
            tl.topMargin = (int) (3 * d);
            sel.addView(tanda, tl);
            if (!on) sel.setOnClickListener(v -> buka(a, kode));
            bar.addView(sel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        }
        col.addView(bar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return col;
    }

    static void buka(Activity a, String kode) {
        Class<?> tujuan;
        switch (kode) {
            case HOME: tujuan = DashboardActivity.class; break;
            case PESANAN: tujuan = OrdersActivity.class; break;
            case PACKING: tujuan = PackingListActivity.class; break;
            case PROMO: tujuan = PromotionActivity.class; break;
            default: return;
        }
        Intent i = new Intent(a, tujuan);
        if (tujuan == DashboardActivity.class) {
            i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        } else {
            i.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        }
        a.startActivity(i);
        a.overridePendingTransition(0, 0);
        if (!(a instanceof DashboardActivity)) a.finish();
    }
}

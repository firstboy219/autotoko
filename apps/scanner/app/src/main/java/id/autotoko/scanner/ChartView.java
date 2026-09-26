package id.autotoko.scanner;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;

import java.util.Locale;

/**
 * Grafik ringkas di atas Canvas (tanpa library) untuk dashboard APK.
 *
 * Prinsip BI yang dijaga: satu skala per grafik dengan garis dasar di 0, grid
 * tipis + label nilai maksimum, label kategori jarang agar tak tabrakan, legenda
 * untuk multi-seri, nilai rupiah diringkas (rb/jt), dan warna konsisten
 * (hijau=order, biru=packing, merah=batal). TIDAK memakai dua sumbu-Y.
 */
public class ChartView extends View {

    public static final int BARS = 0, AREA = 1, HBARS = 2;
    private int mode = BARS;

    private String[] labels = new String[0];
    private String[] seriesNames = new String[0];
    private int[] seriesColors = new int[0];
    private double[][] values = new double[0][]; // [series][kategori]
    private boolean rupiah = false;

    private final Paint pBar = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint pGrid = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint pTxt = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint pTxtB = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint pLine = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint pFill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float d;

    public ChartView(Context c) {
        super(c);
        d = getResources().getDisplayMetrics().density;
        pGrid.setColor(0x14000000); pGrid.setStrokeWidth(Math.max(1, d));
        pTxt.setColor(0xFF6B7178); pTxt.setTextSize(10 * d);
        pTxtB.setColor(0xFF20242B); pTxtB.setTextSize(11 * d); pTxtB.setFakeBoldText(true);
        pLine.setStyle(Paint.Style.STROKE); pLine.setStrokeWidth(2 * d); pLine.setStrokeCap(Paint.Cap.ROUND);
    }

    private int dp(float v) { return (int) (v * d); }

    public void setBars(String[] labels, String[] names, int[] colors, double[][] vals, boolean rp) {
        this.mode = BARS; this.labels = labels; this.seriesNames = names; this.seriesColors = colors; this.values = vals; this.rupiah = rp;
        setMinimumHeight(dp(180)); requestLayout(); invalidate();
    }
    public void setArea(String[] labels, double[] vals, int color, boolean rp) {
        this.mode = AREA; this.labels = labels; this.seriesNames = new String[0]; this.seriesColors = new int[]{ color };
        this.values = new double[][]{ vals }; this.rupiah = rp;
        setMinimumHeight(dp(160)); requestLayout(); invalidate();
    }
    public void setHBars(String[] labels, double[] vals, int color, boolean rp) {
        this.mode = HBARS; this.labels = labels; this.seriesNames = new String[0]; this.seriesColors = new int[]{ color };
        this.values = new double[][]{ vals }; this.rupiah = rp;
        setMinimumHeight(dp(28 * Math.max(1, labels.length) + 20)); requestLayout(); invalidate();
    }

    private double maxVal() {
        double m = 0;
        for (double[] s : values) for (double v : s) if (v > m) m = v;
        return m <= 0 ? 1 : m;
    }

    private String fmt(double v) {
        if (rupiah) {
            if (v >= 1e9) return "Rp" + round1(v / 1e9) + "M";
            if (v >= 1e6) return "Rp" + round1(v / 1e6) + "jt";
            if (v >= 1e3) return "Rp" + Math.round(v / 1e3) + "rb";
            return "Rp" + (long) v;
        }
        return String.valueOf((long) v);
    }
    private static String round1(double v) {
        return (Math.round(v * 10) / 10.0) + "";
    }

    @Override protected void onDraw(Canvas c) {
        super.onDraw(c);
        int w = getWidth(), h = getHeight();
        if (w == 0 || values.length == 0) return;
        if (mode == HBARS) { drawH(c, w, h); return; }

        float legendH = seriesNames.length > 1 ? 18 * d : 0;
        float padL = 34 * d, padR = 8 * d, padT = 10 * d + legendH, padB = 18 * d;
        float plotW = w - padL - padR, plotH = h - padT - padB;
        double max = niceMax(maxVal());

        // grid + label sumbu Y (0, tengah, max)
        for (int g = 0; g <= 2; g++) {
            float y = padT + plotH - (float) (plotH * g / 2.0);
            c.drawLine(padL, y, w - padR, y, pGrid);
            String lab = fmt(max * g / 2.0);
            c.drawText(lab, 2 * d, y + 3.5f * d, pTxt);
        }

        int n = labels.length;
        if (mode == AREA) {
            double[] s = values[0];
            pFill.setColor((seriesColors[0] & 0x00FFFFFF) | 0x22000000);
            pLine.setColor(seriesColors[0]);
            android.graphics.Path path = new android.graphics.Path();
            android.graphics.Path fill = new android.graphics.Path();
            float stepX = n > 1 ? plotW / (n - 1) : 0;
            for (int i = 0; i < n; i++) {
                float x = padL + stepX * i;
                float y = padT + plotH - (float) (plotH * (s[i] / max));
                if (i == 0) { path.moveTo(x, y); fill.moveTo(x, padT + plotH); fill.lineTo(x, y); }
                else { path.lineTo(x, y); fill.lineTo(x, y); }
            }
            fill.lineTo(padL + stepX * (n - 1), padT + plotH); fill.close();
            c.drawPath(fill, pFill);
            c.drawPath(path, pLine);
            // titik + nilai di ujung terakhir
            float lx = padL + stepX * (n - 1), ly = padT + plotH - (float) (plotH * (s[n - 1] / max));
            pBar.setColor(seriesColors[0]); c.drawCircle(lx, ly, 3.5f * d, pBar);
            c.drawText(fmt(s[n - 1]), Math.min(lx - 8 * d, w - padR - 30 * d), ly - 5 * d, pTxtB);
        } else { // BARS (grouped)
            int ns = values.length;
            float slot = plotW / n;
            float groupW = slot * 0.7f;
            float barW = groupW / ns;
            for (int i = 0; i < n; i++) {
                float x0 = padL + slot * i + (slot - groupW) / 2;
                for (int sIdx = 0; sIdx < ns; sIdx++) {
                    double v = values[sIdx][i];
                    float bh = (float) (plotH * (v / max));
                    float left = x0 + barW * sIdx;
                    float top = padT + plotH - bh;
                    pBar.setColor(seriesColors[sIdx]);
                    RectF r = new RectF(left + d, top, left + barW - d, padT + plotH);
                    c.drawRoundRect(r, 2 * d, 2 * d, pBar);
                }
            }
        }

        // label kategori X (jarang: pertama, tengah, terakhir)
        int[] idx = n <= 1 ? new int[]{ 0 } : new int[]{ 0, n / 2, n - 1 };
        for (int i : idx) {
            if (i < 0 || i >= n) continue;
            float slot = plotW / n;
            float x = padL + slot * i + slot / 2;
            String lab = labels[i];
            float tw = pTxt.measureText(lab);
            c.drawText(lab, Math.max(padL, Math.min(x - tw / 2, w - padR - tw)), h - 5 * d, pTxt);
        }

        // legenda
        if (seriesNames.length > 1) {
            float lx = padL, ly = 10 * d;
            for (int sIdx = 0; sIdx < seriesNames.length; sIdx++) {
                pBar.setColor(seriesColors[sIdx]);
                c.drawRoundRect(new RectF(lx, ly, lx + 10 * d, ly + 10 * d), 2 * d, 2 * d, pBar);
                c.drawText(seriesNames[sIdx], lx + 14 * d, ly + 9 * d, pTxt);
                lx += 14 * d + pTxt.measureText(seriesNames[sIdx]) + 16 * d;
            }
        }
    }

    private void drawH(Canvas c, int w, int h) {
        double[] s = values[0];
        int n = labels.length;
        double max = niceMax(maxVal());
        float rowH = 26 * d, barMaxW = w * 0.5f, labelW = w * 0.34f;
        pBar.setColor(seriesColors[0]);
        for (int i = 0; i < n; i++) {
            float cy = 14 * d + rowH * i;
            String lab = labels[i];
            String lab2 = lab.length() > 16 ? lab.substring(0, 15) + "…" : lab;
            c.drawText(lab2, 2 * d, cy + 4 * d, pTxt);
            float bw = (float) (barMaxW * (s[i] / max));
            RectF r = new RectF(labelW, cy - 7 * d, labelW + Math.max(bw, 2 * d), cy + 7 * d);
            c.drawRoundRect(r, 3 * d, 3 * d, pBar);
            c.drawText(fmt(s[i]), labelW + Math.max(bw, 2 * d) + 5 * d, cy + 4 * d, pTxtB);
        }
    }

    /** Bulatkan max ke angka enak (1/2/5 × 10^k) supaya label sumbu rapi. */
    private static double niceMax(double m) {
        if (m <= 0) return 1;
        double exp = Math.floor(Math.log10(m));
        double base = Math.pow(10, exp);
        double f = m / base;
        double nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
        return nice * base;
    }
}

package id.autotoko.scanner;

import android.content.Context;
import android.graphics.Matrix;
import android.graphics.PointF;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;

import androidx.appcompat.widget.AppCompatImageView;

/**
 * A label photograph you can get close to.
 *
 * Written rather than pulled in, for the same reason the ML Kit models are the
 * bundled variants: this app runs on cheap warehouse Androids and every
 * dependency is a thing that can fail to be there. Pinch, drag, double-tap —
 * nothing more, because nothing more is being asked of it.
 *
 * The image is held in a Matrix rather than by swapping scale types, so zoom
 * and pan compose without the view ever re-deciding how to fit the bitmap.
 */
public class ZoomableImageView extends AppCompatImageView {

    /** Below this the photo is smaller than its frame; there is nothing to see. */
    private static final float MIN_SCALE = 1f;
    /**
     * A courier's small print is the reason this exists. Six times is enough to
     * read a waybill on a 12MP photo and not so much that a drag becomes
     * impossible to aim.
     */
    private static final float MAX_SCALE = 6f;
    private static final float DOUBLE_TAP_SCALE = 3f;

    private final Matrix matrix = new Matrix();
    private final float[] values = new float[9];
    private final RectF bounds = new RectF();

    private ScaleGestureDetector scaleDetector;
    private GestureDetector tapDetector;

    private final PointF last = new PointF();
    private boolean dragging = false;
    /** Set once the bitmap and the view size are both known. */
    private boolean fitted = false;

    public ZoomableImageView(Context c) { super(c); init(c); }
    public ZoomableImageView(Context c, AttributeSet a) { super(c, a); init(c); }

    private void init(Context c) {
        super.setScaleType(ScaleType.MATRIX);
        setClickable(true);

        scaleDetector = new ScaleGestureDetector(c, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override public boolean onScale(ScaleGestureDetector d) {
                float factor = d.getScaleFactor();
                float current = currentScale();
                // Clamped here rather than after the fact: letting it overshoot
                // and correcting afterwards makes the image jump under the
                // fingers still touching it.
                if (current * factor < MIN_SCALE) factor = MIN_SCALE / current;
                if (current * factor > MAX_SCALE) factor = MAX_SCALE / current;
                matrix.postScale(factor, factor, d.getFocusX(), d.getFocusY());
                clampToView();
                setImageMatrix(matrix);
                return true;
            }
        });

        tapDetector = new GestureDetector(c, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onDoubleTap(MotionEvent e) {
                // Toggle, not step: on a phone the useful states are "the whole
                // label" and "close enough to read", and a step ladder makes
                // getting back to the first one a chore.
                if (currentScale() > MIN_SCALE * 1.05f) {
                    fitToView();
                } else {
                    matrix.postScale(DOUBLE_TAP_SCALE, DOUBLE_TAP_SCALE, e.getX(), e.getY());
                    clampToView();
                    setImageMatrix(matrix);
                }
                return true;
            }
        });
    }

    @Override public void setImageMatrix(Matrix m) { super.setImageMatrix(m); }

    /** Recompute the fit whenever the drawable or the view size changes. */
    @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        fitted = false;
        fitToView();
    }

    @Override public void setImageBitmap(android.graphics.Bitmap bm) {
        super.setImageBitmap(bm);
        fitted = false;
        fitToView();
    }

    /**
     * Show the whole photograph, centred.
     *
     * A label is usually taller than it is wide and the frame usually is not,
     * so the smaller ratio wins — starting cropped would hide the very corner
     * somebody opened this to read.
     */
    public void fitToView() {
        if (getDrawable() == null || getWidth() == 0 || getHeight() == 0) return;
        float dw = getDrawable().getIntrinsicWidth();
        float dh = getDrawable().getIntrinsicHeight();
        if (dw <= 0 || dh <= 0) return;

        float scale = Math.min(getWidth() / dw, getHeight() / dh);
        matrix.reset();
        matrix.postScale(scale, scale);
        matrix.postTranslate((getWidth() - dw * scale) / 2f, (getHeight() - dh * scale) / 2f);
        setImageMatrix(matrix);
        fitted = true;
    }

    private float currentScale() {
        matrix.getValues(values);
        float base = baseScale();
        return base == 0 ? 1f : values[Matrix.MSCALE_X] / base;
    }

    /** The scale at which the whole image fits, i.e. what MIN_SCALE means. */
    private float baseScale() {
        if (getDrawable() == null || getWidth() == 0) return 0;
        float dw = getDrawable().getIntrinsicWidth();
        float dh = getDrawable().getIntrinsicHeight();
        if (dw <= 0 || dh <= 0) return 0;
        return Math.min(getWidth() / dw, getHeight() / dh);
    }

    /**
     * Keep the photograph against the edges it should be against.
     *
     * Without this a drag can fling the image off screen entirely, and the only
     * way back is to close and reopen — which on a screen opened to check one
     * detail is the whole task lost.
     */
    private void clampToView() {
        if (getDrawable() == null) return;
        bounds.set(0, 0, getDrawable().getIntrinsicWidth(), getDrawable().getIntrinsicHeight());
        matrix.mapRect(bounds);

        float dx = 0, dy = 0;
        if (bounds.width() <= getWidth()) {
            dx = (getWidth() - bounds.width()) / 2f - bounds.left;
        } else if (bounds.left > 0) {
            dx = -bounds.left;
        } else if (bounds.right < getWidth()) {
            dx = getWidth() - bounds.right;
        }

        if (bounds.height() <= getHeight()) {
            dy = (getHeight() - bounds.height()) / 2f - bounds.top;
        } else if (bounds.top > 0) {
            dy = -bounds.top;
        } else if (bounds.bottom < getHeight()) {
            dy = getHeight() - bounds.bottom;
        }
        matrix.postTranslate(dx, dy);
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
        scaleDetector.onTouchEvent(e);
        tapDetector.onTouchEvent(e);

        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                last.set(e.getX(), e.getY());
                dragging = true;
                break;
            case MotionEvent.ACTION_MOVE:
                // Only one finger drags. During a pinch the scale detector is
                // already moving the image around its focus point, and adding a
                // translation on top makes it slide away from the fingers.
                if (dragging && !scaleDetector.isInProgress() && e.getPointerCount() == 1) {
                    matrix.postTranslate(e.getX() - last.x, e.getY() - last.y);
                    clampToView();
                    setImageMatrix(matrix);
                    last.set(e.getX(), e.getY());
                }
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                dragging = false;
                break;
            default:
                break;
        }
        return true;
    }

    /** True once a bitmap has been laid out; used to avoid a flash of nothing. */
    public boolean isFitted() { return fitted; }
}

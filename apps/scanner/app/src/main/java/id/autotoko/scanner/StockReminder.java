package id.autotoko.scanner;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.util.Calendar;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * The daily nudge to check the shelf.
 *
 * Stock levels are the one number here nobody is forced to touch: a resi gets
 * scanned because a parcel is going out, but nothing makes anyone say the
 * glycerine is running low until it has already run out. So this asks.
 *
 * Scheduled on the device rather than pushed from the server, which is a
 * deliberate trade and worth stating. Firebase messaging needs Google Play
 * Services, and this app went out of its way to avoid that dependency — the
 * ML Kit models are the bundled variants precisely so a cheap warehouse Android
 * with no Play Services still reads labels. Reintroducing it for a reminder
 * that does not need a server to decide WHEN would trade a working feature for
 * a fragile one. What the server does decide is WHETHER: the shelf is shared,
 * and a reminder that fires after somebody else already did the round is one
 * people learn to swipe away without reading.
 *
 * The cost of this choice: nobody can push a message from the office. If that
 * is ever wanted, it is a Firebase project and a server key, and it is a
 * different feature from this one.
 */
public final class StockReminder extends Worker {

    private static final String WORK = "autotoko_stock_reminder";
    private static final String CHANNEL = "stock_reminder";
    private static final int NOTIF_ID = 4101;

    /** Late afternoon: the round is done, and there is still time to order. */
    public static final int DEFAULT_HOUR = 16;

    public StockReminder(Context ctx, WorkerParameters params) {
        super(ctx, params);
    }

    // ------------------------------------------------------------------
    // Scheduling
    // ------------------------------------------------------------------

    /**
     * Book the next reminder, replacing any already booked.
     *
     * A one-shot that re-books itself rather than a PeriodicWorkRequest.
     * Periodic work cannot be pinned to a wall-clock hour — its period runs
     * from whenever it was first enqueued — so a reminder meant for the end of
     * the working day drifts into the middle of the night within a week.
     */
    public static void schedule(Context ctx) {
        Session s = new Session(ctx);
        if (!s.reminderEnabled()) {
            cancel(ctx);
            return;
        }
        long delay = millisUntilNext(s.reminderHour());
        WorkManager.getInstance(ctx).enqueueUniqueWork(
                WORK,
                ExistingWorkPolicy.REPLACE,
                new OneTimeWorkRequest.Builder(StockReminder.class)
                        .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                        .setInputData(new Data.Builder().putInt("hour", s.reminderHour()).build())
                        .build());
    }

    public static void cancel(Context ctx) {
        WorkManager.getInstance(ctx).cancelUniqueWork(WORK);
    }

    /** Milliseconds from now to the next occurrence of `hour`:00 local time. */
    static long millisUntilNext(int hour) {
        Calendar now = Calendar.getInstance();
        Calendar next = (Calendar) now.clone();
        next.set(Calendar.HOUR_OF_DAY, hour);
        next.set(Calendar.MINUTE, 0);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        // Already past today, so it is tomorrow's. Equality counts as past:
        // re-booking at exactly the trigger time would fire again immediately.
        if (next.getTimeInMillis() <= now.getTimeInMillis()) {
            next.add(Calendar.DAY_OF_MONTH, 1);
        }
        return next.getTimeInMillis() - now.getTimeInMillis();
    }

    // ------------------------------------------------------------------
    // The work
    // ------------------------------------------------------------------

    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        try {
            Session session = new Session(ctx);
            // Signed out: say nothing, and do not re-book. Signing in
            // schedules it again, so a shared phone that was handed over does
            // not nag the next person about a shelf that is not theirs.
            if (!session.loggedIn()) return Result.success();

            JSONObject data = fetchFreshness(session);
            if (data == null) {
                // Offline or the server is down. Re-book for tomorrow and stay
                // quiet: a warehouse with no signal is not a reason to claim
                // the stock check was missed.
                schedule(ctx);
                return Result.success();
            }

            if (data.optBoolean("due", false)) {
                notify(ctx, data);
            }
            schedule(ctx);
            return Result.success();
        } catch (Exception e) {
            // Never Result.retry(): a retry storm on a broken token would run
            // the request every few minutes all night. Tomorrow will do.
            schedule(ctx);
            return Result.success();
        }
    }

    /**
     * Ask the server, and wait for it.
     *
     * Api delivers on the main thread; a Worker is already off it and must
     * block until the answer arrives or the process may be torn down first.
     */
    private JSONObject fetchFreshness(Session session) throws InterruptedException {
        final AtomicReference<JSONObject> out = new AtomicReference<>(null);
        final CountDownLatch latch = new CountDownLatch(1);
        new Api(session).stockFreshness(r -> {
            if (r.ok()) out.set(r.data());
            latch.countDown();
        });
        // Generous but bounded. WorkManager gives a worker ten minutes; sitting
        // there for all of it on a dead connection wastes the battery it was
        // scheduled to be careful with.
        if (!latch.await(30, TimeUnit.SECONDS)) return null;
        return out.get();
    }

    // ------------------------------------------------------------------
    // The notification
    // ------------------------------------------------------------------

    /** Created on every post: cheap, and idempotent by design on Android. */
    public static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL, "Pengingat stok harian", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("Mengingatkan mengecek stok bahan baku setiap hari.");
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(ch);
    }

    private void notify(Context ctx, JSONObject data) {
        ensureChannel(ctx);

        int stale = data.optInt("staleCount", 0);
        int total = data.optInt("total", 0);
        int doneToday = data.optInt("updatedToday", 0);

        String title = doneToday > 0
                ? "Stok belum selesai dicek"
                : "Stok hari ini belum dicek";

        // Naming one is what turns a chore into a task. "12 bahan" is a number
        // to postpone; "Glycerin" is something to walk over and look at.
        JSONObject oldest = data.optJSONObject("oldest");
        String name = oldest != null ? oldest.optString("name", "") : "";
        StringBuilder body = new StringBuilder();
        body.append(stale).append(" dari ").append(total).append(" bahan belum diperbarui");
        if (doneToday > 0) body.append(" (").append(doneToday).append(" sudah)");
        body.append(".");
        if (!name.isEmpty()) body.append(" Paling lama: ").append(name).append(".");

        Intent open = new Intent(ctx, StockActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                ctx, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification n = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body.toString())
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body.toString()))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();

        try {
            NotificationManagerCompat.from(ctx).notify(NOTIF_ID, n);
        } catch (SecurityException ignored) {
            // Permission refused on Android 13+. Nothing to do and nothing
            // worth crashing a background worker over.
        }
    }
}

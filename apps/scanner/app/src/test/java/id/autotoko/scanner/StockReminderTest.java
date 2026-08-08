package id.autotoko.scanner;

import static org.junit.Assert.assertTrue;

import java.util.Calendar;

import org.junit.Test;

/**
 * The scheduling arithmetic, which is the part that fails silently.
 *
 * A reminder that computes the wrong delay does not crash — it simply never
 * arrives, or arrives at three in the morning, and nobody reports either as a
 * bug because there is nothing to see.
 */
public class StockReminderTest {

    private static final long HOUR = 3600_000L;
    private static final long DAY = 24 * HOUR;

    @Test
    public void always_lands_within_the_next_day() {
        for (int h = 0; h < 24; h++) {
            long ms = StockReminder.millisUntilNext(h);
            assertTrue("jam " + h + " memberi " + ms, ms > 0);
            assertTrue("jam " + h + " lebih dari sehari: " + ms, ms <= DAY);
        }
    }

    @Test
    public void the_hour_already_past_today_is_tomorrows() {
        Calendar now = Calendar.getInstance();
        int current = now.get(Calendar.HOUR_OF_DAY);
        // An hour that has definitely gone: two before now, wrapping.
        int past = (current + 22) % 24;
        long ms = StockReminder.millisUntilNext(past);
        // More than twenty hours away, i.e. tomorrow rather than a negative
        // delay or an immediate re-fire.
        assertTrue("harusnya besok, dapat " + ms + "ms", ms > 20 * HOUR);
    }

    @Test
    public void the_current_hour_does_not_fire_immediately() {
        // Re-booking at exactly the trigger time must not schedule zero, or the
        // worker re-queues itself in a loop for the rest of the hour.
        long ms = StockReminder.millisUntilNext(Calendar.getInstance().get(Calendar.HOUR_OF_DAY));
        assertTrue("jam berjalan memberi " + ms, ms > 0);
    }

    @Test
    public void a_later_hour_today_is_less_than_a_day_away() {
        Calendar now = Calendar.getInstance();
        int current = now.get(Calendar.HOUR_OF_DAY);
        if (current >= 22) return; // no "later today" to test against
        long ms = StockReminder.millisUntilNext(current + 2);
        assertTrue("harusnya hari ini, dapat " + ms + "ms", ms < 3 * HOUR);
    }
}

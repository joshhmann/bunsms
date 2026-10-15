package server;

import client.Client;
import client.inventory.manipulator.InventoryManipulator;

/**
 * Daily Check-In reward table — THE ONE FILE YOU EDIT to define what each of the 28 days grants.
 *
 * <p>============================== MOCK / SAMPLE DATA ==============================
 * Out of the box every day grants 1 meso, with a generic potion icon (2000000) so the window
 * renders. Replace the DAYS table below with your own rewards. Each day supports:
 * <ul>
 *   <li>iconItemId : the item whose icon is drawn in that day's slot (sent to the client). Must be a
 *       REAL item id with an icon. For meso-only days, pick any representative item.</li>
 *   <li>mesos      : mesos granted on claim (0 = none).</li>
 *   <li>grants     : items granted on claim (id, qty, optional expireDays for timed cash items).</li>
 *   <li>slotType   : 0 = none, else an inventory type to expand on claim (1=Equip 2=Use 3=Set-up
 *       4=Etc 5=Cash) by slotCount slots, via Character.gainSlots.</li>
 * </ul>
 * The tooltip the client shows on hover is built from this table (item names via
 * ItemInformationProvider.getName + mesos/slot lines).
 * ===============================================================================
 *
 * <p>Server side of the Detours-DLL check-in window (opcodes 0x11A C2S / 0x17C S2C).
 * Client window/hooks/addresses live DLL-side; this class only defines rewards.
 */
public final class DailyCheckinRewards {

    private static final long ONE_DAY_MS = 86_400_000L;
    public static final int CYCLE_DAYS = 28;
    /** Characters below this level can't see or use the Daily Check-In window. */
    public static final int MIN_LEVEL = 10;

    /** A single item grant. expireDays 0 = permanent; >0 = expires that many days from claim. */
    public record Grant(int itemId, int qty, int expireDays) {
        public Grant(int itemId, int qty) {
            this(itemId, qty, 0);
        }
    }

    /** One day's reward. */
    public record Reward(int iconItemId, int mesos, Grant[] grants, int slotType, int slotCount) {
        Reward(int iconItemId, int mesos, Grant[] grants) {
            this(iconItemId, mesos, grants, 0, 0);
        }
    }

    private static final Grant[] NONE = new Grant[0];

    // Placeholder icon for the mock (a basic potion, present in every v83 client). Replace per day.
    private static final int PLACEHOLDER_ICON = 2000000;

    // -------- EDIT THIS TABLE -------- (index 0 = Day 1 ... index 27 = Day 28)
    private static final Reward[] DAYS;

    static {
        DAYS = new Reward[CYCLE_DAYS];
        for (int d = 0; d < CYCLE_DAYS; d++) {
            DAYS[d] = new Reward(PLACEHOLDER_ICON, 1, NONE);   // mock: 1 meso, generic icon, no items
        }
        // ---- Example of a richer day (uncomment + adapt) ----
        // DAYS[6]  = new Reward(2340000, 0, new Grant[]{ new Grant(2340000, 5) });          // Day 7: White Scroll x5
        // DAYS[13] = new Reward(5050000, 0, new Grant[]{ new Grant(5050000, 1, 7) });        // Day 14: AP Reset (7-day)
        // DAYS[20] = new Reward(2000005, 1_000_000, new Grant[]{ new Grant(2000005, 100) }); // Day 21: 100 Power Elixir + 1M mesos
        // DAYS[24] = new Reward(2000000, 0, NONE, 2, 8);                                      // Day 25: +8 Use slots
    }

    private DailyCheckinRewards() {
    }

    private static String slotTabName(int t) {
        switch (t) {
            case 1:  return "Equip";
            case 2:  return "Use";
            case 3:  return "Set-up";
            case 4:  return "Etc";
            case 5:  return "Cash";
            default: return "";
        }
    }

    /** Item id whose icon the client draws for {@code day} (1-based), or 0 if out of range. */
    public static int iconItemId(int day) {
        if (day < 1 || day > DAYS.length) {
            return 0;
        }
        return DAYS[day - 1].iconItemId();
    }

    /**
     * Grant the full reward for {@code day} (1-based). Best-effort: each piece is granted
     * independently. Returns false only if the day is out of range.
     */
    public static boolean grantDay(Client c, int day) {
        if (day < 1 || day > DAYS.length) {
            return false;
        }
        Reward r = DAYS[day - 1];
        if (r.mesos() > 0) {
            c.getPlayer().gainMeso(r.mesos(), true);
        }
        for (Grant g : r.grants()) {
            long expiration = g.expireDays() > 0 ? System.currentTimeMillis() + g.expireDays() * ONE_DAY_MS : -1;
            InventoryManipulator.addById(c, g.itemId(), (short) g.qty(), expiration);
        }
        if (r.slotType() > 0 && r.slotCount() > 0) {
            c.getPlayer().gainSlots(r.slotType(), r.slotCount());
        }
        return true;
    }

    /** Human-readable multi-line breakdown for {@code day}, used as the client's hover tooltip. */
    public static String tooltip(int day) {
        if (day < 1 || day > DAYS.length) {
            return "";
        }
        Reward r = DAYS[day - 1];
        StringBuilder sb = new StringBuilder();
        sb.append("Day ").append(day).append('\n');
        for (Grant g : r.grants()) {
            String name = lookupItemName(g.itemId());
            sb.append("- ").append(name);
            if (g.qty() > 1) {
                sb.append(" x").append(g.qty());
            }
            if (g.expireDays() > 0) {
                sb.append(" (").append(g.expireDays()).append(g.expireDays() == 1 ? " day)" : " days)");
            }
            sb.append('\n');
        }
        if (r.mesos() > 0) {
            sb.append("- ").append(String.format("%,d", r.mesos())).append(" mesos\n");
        }
        if (r.slotType() > 0 && r.slotCount() > 0) {
            sb.append("- +").append(r.slotCount()).append(' ').append(slotTabName(r.slotType())).append(" slots\n");
        }
        int len = sb.length();
        if (len > 0 && sb.charAt(len - 1) == '\n') {
            sb.setLength(len - 1);
        }
        return sb.toString();
    }

    /**
     * Best-effort item-name lookup. Never throws: the snapshot builder runs on the channel packet
     * thread, so a missing/corrupt String.wz must degrade to "Item &lt;id&gt;" instead of killing
     * the reply (or poisoning the provider's static init for later calls).
     */
    private static String lookupItemName(int itemId) {
        try {
            String name = ItemInformationProvider.getInstance().getName(itemId);
            if (name == null || name.isBlank()) {
                name = "Item " + itemId;
            }
            return name;
        } catch (Throwable t) {
            return "Item " + itemId;
        }
    }
}

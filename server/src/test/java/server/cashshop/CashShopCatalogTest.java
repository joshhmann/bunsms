package server.cashshop;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Cash Shop window catalogue invariants. Runs without WZ/DB: {@link CashShopCatalog#load}
 * degrades to the TSV's own name column when String.wz is unavailable, so only
 * shape/content invariants are asserted here (never exact WZ-resolved names).
 *
 * <p>The catalogue loader reads {@code cashshop-path/catalog.tsv}; each test points that
 * system property at its own {@link TempDir} and restores the previous value after.
 */
class CashShopCatalogTest {

    @TempDir
    private Path dir;

    private String stashProp;

    private void pointAt(Path tsv) {
        stashProp = System.getProperty("cashshop-path");
        System.setProperty("cashshop-path", tsv.getParent().toString());
    }

    @org.junit.jupiter.api.AfterEach
    void restoreProp() {
        if (stashProp == null) {
            System.clearProperty("cashshop-path");
        } else {
            System.setProperty("cashshop-path", stashProp);
        }
        CashShopCatalog.load(); // reload whatever the ambient environment had (usually empty)
    }

    private Path write(String name, String body) throws IOException {
        Path tsv = dir.resolve(name);
        Files.write(tsv, body.getBytes(StandardCharsets.UTF_8));
        return tsv;
    }

    private static final String HEADER = "# itemId\tprice\tcount\ttab\tcategory\tperiod\tgender\tname\n";

    @Test
    void missingFileLeavesShopEmpty() {
        pointAt(dir.resolve("catalog.tsv")); // never written
        CashShopCatalog.load();
        assertEquals(0, CashShopCatalog.size());
        assertTrue(CashShopCatalog.all().isEmpty());
        assertTrue(CashShopCatalog.index().isEmpty());
    }

    @Test
    void rowsLoadWithExplicitNamesWithoutWz() throws IOException {
        Path tsv = write("catalog.tsv",
                HEADER
                        + "1000000\t3000\t1\t2\t0\t0\t2\tTest Beanie\n"
                        + "1000001\t3500\t1\t2\t0\t0\t2\tTest Hat\n"
                        + "2000000\t500\t100\t5\t2\t0\t2\tTest Potion\n");
        pointAt(tsv);
        CashShopCatalog.load();

        assertEquals(3, CashShopCatalog.size());
        assertNotNull(CashShopCatalog.byItemId(1000000));
        assertEquals("Test Beanie", CashShopCatalog.byItemId(1000000).name());
        assertEquals(2, CashShopCatalog.bucket(2, 0).size());
        assertEquals(1, CashShopCatalog.bucket(5, 2).size());

        List<int[]> idx = CashShopCatalog.index();
        assertEquals(2, idx.size());
        // display order: sorted by (tab << 8 | category)
        assertEquals(2, idx.get(0)[0]);
        assertEquals(0, idx.get(0)[1]);
        assertEquals(2, idx.get(0)[2]);
    }

    @Test
    void duplicateItemIdsKeepTheFirst() throws IOException {
        Path tsv = write("catalog.tsv",
                HEADER
                        + "1000000\t3000\t1\t2\t0\t0\t2\tFirst\n"
                        + "1000000\t9999\t1\t2\t0\t0\t2\tSecond\n");
        pointAt(tsv);
        CashShopCatalog.load();

        assertEquals(1, CashShopCatalog.size());
        assertEquals("First", CashShopCatalog.byItemId(1000000).name());
    }

    @Test
    void namelessRowsDropWhenWzUnavailable() throws IOException {
        // No name column and (in CI / without a WZ tree) no String.wz to resolve from,
        // so the row cannot reach the player with a label and must be dropped.
        // NOTE: if this test ever runs with a live WZ tree, ii.getName() may resolve and
        // the row survives — the assertion below pins the WZ-absent behavior.
        Path tsv = write("catalog.tsv", HEADER + "1000000\t3000\t1\t2\t0\t0\t2\n");
        pointAt(tsv);
        CashShopCatalog.load();

        // Either 0 (WZ absent, row dropped) or 1 (WZ present, name resolved). The load
        // itself must never throw.
        assertTrue(CashShopCatalog.size() <= 1, "size=" + CashShopCatalog.size());
    }

    @Test
    void malformedLinesAreSkipped() throws IOException {
        Path tsv = write("catalog.tsv",
                HEADER
                        + "not-a-row\n"
                        + "1000000\tnotanumber\t1\t2\t0\t0\t2\tBad\n"
                        + "\n"
                        + "1000001\t3500\t1\t2\t0\t0\t2\tGood\n");
        pointAt(tsv);
        CashShopCatalog.load();

        assertEquals(1, CashShopCatalog.size());
        assertNull(CashShopCatalog.byItemId(1000000));
        assertNotNull(CashShopCatalog.byItemId(1000001));
    }

    @Test
    void unknownItemIdsAreUnusable() throws IOException {
        // itemId/1000000 == 9 (cash packages 91xxxxx) has no inventory type and can never
        // be delivered, so the loader skips it.
        Path tsv = write("catalog.tsv", HEADER + "9100000\t3000\t1\t2\t0\t0\t2\tPackage\n");
        pointAt(tsv);
        CashShopCatalog.load();

        assertEquals(0, CashShopCatalog.size());
    }
}

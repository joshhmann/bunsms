package server.transactions;

import client.Character;
import client.Client;
import client.inventory.Equip;
import client.inventory.Inventory;
import client.inventory.InventoryType;
import client.inventory.Item;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import config.YamlConfig;
import database.DatabaseMigrations;
import io.netty.channel.embedded.EmbeddedChannel;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import server.ItemInformationProvider;
import server.Shop;
import tools.DatabaseConnection;

import java.lang.reflect.Field;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Opt-in consumer tests: disposable local MySQL schema, real WZ items and inventory. */
@EnabledIfSystemProperty(named = "economy.jdbc.admin", matches = ".+")
class EconomyIntegrationTest {
    private static HikariDataSource pool;
    private static Object previousPool;
    private static int previousMaximum;
    private static String schema;
    private static String adminUrl;
    private static String password;

    @BeforeAll
    static void startDatabase() throws Exception {
        adminUrl = System.getProperty("economy.jdbc.admin");
        password = System.getProperty("economy.jdbc.password");
        if (!adminUrl.startsWith("jdbc:mysql://127.0.0.1:")) {
            throw new IllegalArgumentException("Economy tests require a disposable loopback database");
        }
        schema = "economy_" + UUID.randomUUID().toString().replace("-", "");
        try (Connection connection = DriverManager.getConnection(adminUrl, "root", password);
             Statement sql = connection.createStatement()) {
            sql.execute("CREATE DATABASE `" + schema + "`");
        }
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(adminUrl + schema);
        config.setUsername("root");
        config.setPassword(password);
        config.setMaximumPoolSize(8);
        pool = new HikariDataSource(config);
        Field dataSource = DatabaseConnection.class.getDeclaredField("dataSource");
        dataSource.setAccessible(true);
        previousPool = dataSource.get(null);
        dataSource.set(null, pool);
        previousMaximum = YamlConfig.config.server.MAXIMUM_TRANSACTIONS_FOR_BUYBACK;
        YamlConfig.config.server.MAXIMUM_TRANSACTIONS_FOR_BUYBACK = 20;
        DatabaseMigrations.runDatabaseMigrations();
    }

    @AfterAll
    static void stopDatabase() throws Exception {
        if (pool == null) {
            return;
        }
        Field dataSource = DatabaseConnection.class.getDeclaredField("dataSource");
        dataSource.setAccessible(true);
        dataSource.set(null, previousPool);
        YamlConfig.config.server.MAXIMUM_TRANSACTIONS_FOR_BUYBACK = previousMaximum;
        pool.close();
        try (Connection connection = DriverManager.getConnection(adminUrl, "root", password);
             Statement sql = connection.createStatement()) {
            sql.execute("DROP DATABASE `" + schema + "`");
        }
    }

    private static Character player() throws Exception {
        Client client = Client.createMock();
        Field channel = Client.class.getDeclaredField("ioChannel");
        channel.setAccessible(true);
        channel.set(client, new EmbeddedChannel());
        String name = "E" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        int characterId;
        try (Connection connection = pool.getConnection(); Statement sql = connection.createStatement()) {
            sql.executeUpdate("INSERT INTO accounts(name,password) VALUES ('" + name + "','test')", Statement.RETURN_GENERATED_KEYS);
            int account;
            try (ResultSet keys = sql.getGeneratedKeys()) {
                assertTrue(keys.next());
                account = keys.getInt(1);
            }
            client.setAccID(account);
            client.setAccountName(name);
            sql.executeUpdate("INSERT INTO characters(accountid,name,world) VALUES (" + account + ",'" + name + "',0)", Statement.RETURN_GENERATED_KEYS);
            try (ResultSet keys = sql.getGeneratedKeys()) {
                assertTrue(keys.next());
                characterId = keys.getInt(1);
            }
        }
        Character player = Character.getDefault(client);
        client.setPlayer(player);
        player.setID(characterId);
        player.setName(name);
        return player;
    }

    private static Shop shop() {
        Shop shop = Shop.createFromDB(11000, true);
        assertNotNull(shop);
        return shop;
    }

    private static void replayShopSql(String path) throws Exception {
        String script;
        try (var input = EconomyIntegrationTest.class.getClassLoader().getResourceAsStream(path)) {
            assertNotNull(input, "The replay must execute the actual shipped SQL resource");
            script = new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        }
        try (Connection connection = pool.getConnection(); Statement sql = connection.createStatement()) {
            for (String statement : liquibase.util.StringUtil.processMultiLineSQL(script, false, true, null)) {
                sql.execute(statement);
            }
        }
    }

    private static List<String> protectedShopRows() throws Exception {
        List<String> rows = new java.util.ArrayList<>();
        try (Connection connection = pool.getConnection(); Statement sql = connection.createStatement();
             ResultSet result = sql.executeQuery("SELECT shopitemid,shopid,itemid,price,pitch,position FROM shopitems WHERE shopid IN (1337,9999001) ORDER BY shopitemid")) {
            while (result.next()) {
                rows.add(result.getInt(1) + ":" + result.getInt(2) + ":" + result.getInt(3)
                        + ":" + result.getInt(4) + ":" + result.getInt(5) + ":" + result.getInt(6));
            }
        }
        return rows;
    }

    private static void assertOnlyShopQuote(int shop, int item, int price, int position) throws Exception {
        try (Connection connection = pool.getConnection(); Statement sql = connection.createStatement();
             ResultSet result = sql.executeQuery("SELECT price,pitch,position FROM shopitems WHERE shopid=" + shop + " AND itemid=" + item)) {
            assertTrue(result.next(), "A missing imported pair must be restored");
            assertEquals(price, result.getInt("price"));
            assertEquals(0, result.getInt("pitch"));
            assertEquals(position, result.getInt("position"));
            assertFalse(result.next(), "A replay must not expose a second purchasable quote for an existing item");
        }
    }

    @Test
    void replayingShopSeedsKeepsTheExistingQuoteAndPurchaseBehavior() throws Exception {
        List<String> protectedBefore = protectedShopRows();
        try {
            try (Connection connection = pool.getConnection(); Statement sql = connection.createStatement()) {
                sql.executeUpdate("UPDATE shopitems SET price=7,position=30000 WHERE shopid=2082014 AND itemid=2040004");
            }
            for (int attempt = 0; attempt < 2; attempt++) {
                replayShopSql("db/data/172-mapleroot-shops-data.sql");
                replayShopSql("db/data/173-mapleroot-shops-remainder-data.sql");
                assertOnlyShopQuote(2082014, 2040004, 7, 30000);
                assertEquals(protectedBefore, protectedShopRows(), "GM and casino rows must remain byte-for-field unchanged");
            }
            Character player = player();
            player.gainMeso(100, false);
            Shop importedShop = Shop.createFromDB(2082014, true);
            assertNotNull(importedShop);
            importedShop.sendShop(player.getClient());
            importedShop.buy(player.getClient(), (short) 0, 2040004, (short) 1);
            assertEquals(93, player.getMeso(), "A normal purchase must still use the preserved custom quote");
            assertEquals(1, player.getInventory(InventoryType.USE).countById(2040004));
        } finally {
            try (Connection connection = pool.getConnection(); Statement sql = connection.createStatement()) {
                sql.executeUpdate("UPDATE shopitems SET price=480000,position=1 WHERE shopid=2082014 AND itemid=2040004");
            }
        }
    }

    @Test
    void incompleteShopImportsResumeAndKnownHistoricalChecksumsStillStart() throws Exception {
        List<String> protectedBefore = protectedShopRows();
        try (Connection connection = pool.getConnection(); Statement sql = connection.createStatement()) {
            sql.executeUpdate("DELETE FROM shopitems WHERE (shopid=2082014 AND itemid=2040004)"
                    + " OR (shopid=9110002 AND itemid=3010019)"
                    + " OR (shopid=9201101 AND itemid=2022338)"
                    + " OR (shopid=1338 AND itemid=2030100)");
        }
        replayShopSql("db/data/172-mapleroot-shops-data.sql");
        replayShopSql("db/data/173-mapleroot-shops-remainder-data.sql");
        assertOnlyShopQuote(2082014, 2040004, 480000, 1);
        assertOnlyShopQuote(9110002, 3010019, 7700000, 92);
        assertOnlyShopQuote(9201101, 2022338, 2100000, 100);
        assertOnlyShopQuote(1338, 2030100, 450, 114);
        assertEquals(protectedBefore, protectedShopRows());
        try (Connection connection = pool.getConnection(); Statement sql = connection.createStatement()) {
            sql.executeUpdate("UPDATE DATABASECHANGELOG SET MD5SUM='9:67f0d41280acd0ea092e7b295e069a63'"
                    + " WHERE ID='172' AND AUTHOR='solobots' AND FILENAME='db/changelog-data.xml'");
        }
        DatabaseMigrations.runDatabaseMigrations();
        assertOnlyShopQuote(2082014, 2040004, 480000, 1);
        assertEquals(protectedBefore, protectedShopRows());
    }

    @Test
    void completedChairQuestStillBuysThroughTheActualNpcConversation() throws Exception {
        var gameServer = net.server.Server.getInstance();
        Field ticksField = net.server.Server.class.getDeclaredField("currentTime");
        ticksField.setAccessible(true);
        var ticks = (java.util.concurrent.atomic.AtomicLong) ticksField.get(gameServer);
        long oldTicks = ticks.get();
        long oldPublishedTime = gameServer.getCurrentTime();
        Field publishedTime = net.server.Server.class.getDeclaredField("serverCurrentTime");
        publishedTime.setAccessible(true);
        var factory = server.ShopFactory.getInstance();
        Field shopsField = server.ShopFactory.class.getDeclaredField("shops");
        shopsField.setAccessible(true);
        var shops = (java.util.Map<Integer, Shop>) shopsField.get(factory);
        Field npcShopsField = server.ShopFactory.class.getDeclaredField("npcShops");
        npcShopsField.setAccessible(true);
        var npcShops = (java.util.Map<Integer, Shop>) npcShopsField.get(factory);
        boolean hadShop = shops.containsKey(9110002);
        boolean hadNpcShop = npcShops.containsKey(9110002);
        Shop oldShop = shops.remove(9110002);
        Shop oldNpcShop = npcShops.remove(9110002);
        try {
            gameServer.forceUpdateCurrentTime();
            for (var status : new client.QuestStatus.Status[]{client.QuestStatus.Status.NOT_STARTED, client.QuestStatus.Status.COMPLETED}) {
                Character player = player();
                player.getQuest(8074).setStatus(status);
                player.gainMeso(20000000, false);
                var scripts = scripting.npc.NPCScriptManager.getInstance();
                assertTrue(scripts.start(player.getClient(), 9110002, (Character) null));
                Shop opened = player.getShop();
                assertNotNull(opened, "Both ordinary quest states must reach the actual stocked shop, not an active-CM reopen");
                opened.buy(player.getClient(), (short) 0, 3010007, (short) 1);
                assertEquals(10000000, player.getMeso());
                assertEquals(1, player.getInventory(InventoryType.SETUP).countById(3010007));
                assertEquals(status, player.getQuest(8074).getStatus(), "Opening/buying must not alter the quest");
            }
        } finally {
            ticks.set(oldTicks);
            publishedTime.setLong(gameServer, oldPublishedTime);
            if (hadShop) {
                shops.put(9110002, oldShop);
            } else {
                shops.remove(9110002);
            }
            if (hadNpcShop) {
                npcShops.put(9110002, oldNpcShop);
            } else {
                npcShops.remove(9110002);
            }
        }
    }

    @Test
    void failedFullInventoryRedemptionLeavesTheSaleAvailable() throws Exception {
        Character player = player();
        Inventory inventory = player.getInventory(InventoryType.USE);
        inventory.setSlotLimit(1);
        Item sold = new Item(2000000, (short) 1, (short) 10);
        sold.setOwner("Seller");
        sold.setFlag((short) 1);
        inventory.addItemFromDB(sold);
        player.gainMeso(10000, false);
        shop().sell(player.getClient(), InventoryType.USE, (short) 1, (short) 10);
        Item incompatible = new Item(2000000, (short) 1, (short) 1);
        inventory.addItemFromDB(incompatible);
        int before = player.getMeso();
        var result = TransactionService.processTransaction(player, lastSale(player).transactionId());
        assertFalse(result.getResult());
        assertEquals(before, player.getMeso());
        assertEquals(1, inventory.getItem((short) 1).getQuantity());
        assertFalse(TransactionService.getLastTransactions(player.getId(), 20).get(0).buybackUsed(),
                "A rejected grant must not permanently consume the recorded sale");
    }

    @Test
    void failedEquipLedgerInsertDoesNotExposeAnIncompleteSale() throws Exception {
        Character player = player();
        Equip equip = (Equip) ItemInformationProvider.getInstance().getEquipById(1302000);
        equip.setPosition((short) 1);
        equip.setStr((short) 17);
        equip.setTint((short) 123, (byte) 42, (byte) -7);
        player.getInventory(InventoryType.EQUIP).addItemFromDB(equip);
        try (Connection connection = pool.getConnection(); Statement sql = connection.createStatement()) {
            sql.execute("CREATE TRIGGER reject_economy_equip BEFORE INSERT ON transaction_equips FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='intentional isolated equip insert failure'");
        }
        try {
            shop().sell(player.getClient(), InventoryType.EQUIP, (short) 1, (short) 1);
            assertTrue(TransactionService.getLastTransactions(player.getId(), 20).isEmpty(),
                    "A failed child insert must not leave a redeemable partial ledger");
            assertNotNull(player.getInventory(InventoryType.EQUIP).getItem((short) 1),
                    "Failed sale recording must restore the original item");
            assertEquals(0, player.getMeso());
        } finally {
            try (Connection connection = pool.getConnection(); Statement sql = connection.createStatement()) {
                sql.execute("DROP TRIGGER reject_economy_equip");
            }
        }
    }

    private static Transaction lastSale(Character player) {
        return TransactionService.getLastTransactions(player.getId(), 20).get(0);
    }

    private static List<tools.Pair<Item, InventoryType>> reloadedItems(Character player) throws Exception {
        return client.inventory.ItemFactory.INVENTORY.loadItems(player.getId(), false);
    }

    private static int reloadedMesos(Character player) throws Exception {
        try (Connection connection = pool.getConnection();
             var sql = connection.prepareStatement("SELECT meso FROM characters WHERE id = ?")) {
            sql.setInt(1, player.getId());
            try (ResultSet row = sql.executeQuery()) {
                assertTrue(row.next());
                return row.getInt(1);
            }
        }
    }

    @Test
    void exactCasinoCreditAndQuantitySurviveReloadAndRedemption() throws Exception {
        Character player = player();
        player.gainMeso(Integer.MAX_VALUE - 100, false);
        Item chips = new Item(4002000, (short) 1, (short) 3);
        player.getInventory(InventoryType.ETC).addItemFromDB(chips);
        shop().sell(player.getClient(), InventoryType.ETC, (short) 1, (short) 3);
        Transaction sale = lastSale(player);
        assertEquals(100, sale.creditedMesos());
        assertEquals(Integer.MAX_VALUE, reloadedMesos(player));
        assertTrue(reloadedItems(player).isEmpty());
        var result = TransactionService.processTransaction(player, sale.transactionId());
        assertTrue(result.getResult(), result.getMessage());
        assertEquals(Integer.MAX_VALUE - 100, player.getMeso());
        assertEquals(player.getMeso(), reloadedMesos(player));
        assertEquals(3, reloadedItems(player).get(0).getLeft().getQuantity());
        assertTrue(lastSale(player).buybackUsed());
    }

    @Test
    void tintedEquipmentRetainsStatsAndBothTintsAcrossSaleRedeemAndReload() throws Exception {
        Character player = player();
        Equip equip = (Equip) ItemInformationProvider.getInstance().getEquipById(1302000);
        equip.setPosition((short) 1);
        equip.setStr((short) 17);
        equip.setWatk((short) 83);
        equip.setOwner("Original");
        equip.setTint((short) 123, (byte) 42, (byte) -7);
        equip.setFxTint((short) 234, (byte) -23, (byte) 9);
        player.getInventory(InventoryType.EQUIP).addItemFromDB(equip);
        shop().sell(player.getClient(), InventoryType.EQUIP, (short) 1, (short) 1);
        Transaction sale = lastSale(player);
        assertTrue(reloadedItems(player).isEmpty());
        var result = TransactionService.processTransaction(player, sale.transactionId());
        assertTrue(result.getResult(), result.getMessage());
        Equip restored = (Equip) reloadedItems(player).get(0).getLeft();
        assertEquals(17, restored.getStr());
        assertEquals(83, restored.getWatk());
        assertEquals("Original", restored.getOwner());
        assertEquals(123, restored.getTintHue());
        assertEquals(42, restored.getTintChroma());
        assertEquals(-7, restored.getTintBright());
        assertEquals(234, restored.getTintFxHue());
        assertEquals(-23, restored.getTintFxChroma());
        assertEquals(9, restored.getTintFxBright());
    }

    @Test
    void sqlFailureAfterGrantsRollsBackInventoryBalanceAndClaimThenCanRetry() throws Exception {
        Character player = player();
        player.getInventory(InventoryType.USE).addItemFromDB(new Item(2000000, (short) 1, (short) 10));
        shop().sell(player.getClient(), InventoryType.USE, (short) 1, (short) 10);
        Transaction sale = lastSale(player);
        int balance = player.getMeso();
        try (Connection connection = pool.getConnection(); Statement sql = connection.createStatement()) {
            sql.execute("CREATE TRIGGER reject_economy_inventory BEFORE INSERT ON inventoryitems FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='intentional isolated inventory persistence failure'");
        }
        try {
            var result = TransactionService.processTransaction(player, sale.transactionId());
            assertFalse(result.getResult());
            assertTrue(player.getInventory(InventoryType.USE).list().isEmpty());
            assertTrue(reloadedItems(player).isEmpty());
            assertEquals(balance, player.getMeso());
            assertEquals(balance, reloadedMesos(player));
            assertFalse(lastSale(player).buybackUsed());
        } finally {
            try (Connection connection = pool.getConnection(); Statement sql = connection.createStatement()) {
                sql.execute("DROP TRIGGER reject_economy_inventory");
            }
        }
        assertTrue(TransactionService.processTransaction(player, sale.transactionId()).getResult());
        assertEquals(10, reloadedItems(player).get(0).getLeft().getQuantity());
    }

    /** Fault injector at the real inventory boundary; the first grant mutates normally. */
    private static final class RejectSecondAddInventory extends Inventory {
        private int added;

        private RejectSecondAddInventory(Character player) {
            super(player, InventoryType.USE, (byte) 2);
        }

        @Override
        public short addItem(Item item) {
            if (++added == 2) {
                return -1;
            }
            return super.addItem(item);
        }
    }

    @Test
    void partialMutationInsideOneRealDropGrantIsCompletelyRestored() throws Exception {
        Character player = player();
        int maximum = ItemInformationProvider.getInstance().getSlotMax(player.getClient(), 2000000);
        short quantity = (short) (maximum + 1);
        player.getInventory(InventoryType.USE).addItemFromDB(new Item(2000000, (short) 1, quantity));
        shop().sell(player.getClient(), InventoryType.USE, (short) 1, quantity);
        Transaction sale = lastSale(player);
        Field inventories = Character.class.getDeclaredField("inventory");
        inventories.setAccessible(true);
        Inventory[] all = (Inventory[]) inventories.get(player);
        all[InventoryType.USE.ordinal()] = new RejectSecondAddInventory(player);
        int balance = player.getMeso();
        var result = TransactionService.processTransaction(player, sale.transactionId());
        assertFalse(result.getResult());
        assertTrue(player.getInventory(InventoryType.USE).list().isEmpty());
        assertTrue(reloadedItems(player).isEmpty());
        assertEquals(balance, player.getMeso());
        assertFalse(lastSale(player).buybackUsed());
        assertTrue(TransactionService.processTransaction(player, sale.transactionId()).getResult());
        assertEquals(quantity, reloadedItems(player).stream().mapToInt(pair -> pair.getLeft().getQuantity()).sum());
    }

    @Test
    void simultaneousRedemptionsHaveExactlyOneSuccessfulChargeAndGrant() throws Exception {
        Character player = player();
        player.getInventory(InventoryType.USE).addItemFromDB(new Item(2000000, (short) 1, (short) 10));
        shop().sell(player.getClient(), InventoryType.USE, (short) 1, (short) 10);
        int transaction = lastSale(player).transactionId();
        var gate = new java.util.concurrent.CyclicBarrier(2);
        try (var workers = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            java.util.concurrent.Callable<Boolean> redeem = () -> {
                gate.await();
                return TransactionService.processTransaction(player, transaction).getResult();
            };
            var first = workers.submit(redeem);
            var second = workers.submit(redeem);
            assertNotEquals(first.get(), second.get());
        }
        assertEquals(0, player.getMeso());
        assertEquals(0, reloadedMesos(player));
        assertEquals(10, reloadedItems(player).get(0).getLeft().getQuantity());
        assertFalse(TransactionService.processTransaction(player, transaction).getResult());
    }

    @Test
    void invalidForeignUnquotedAndInsufficientFundsLeaveEverythingUnchanged() throws Exception {
        Character player = player();
        Character other = player();
        player.getInventory(InventoryType.USE).addItemFromDB(new Item(2000000, (short) 1, (short) 10));
        shop().sell(player.getClient(), InventoryType.USE, (short) 1, (short) 10);
        int transaction = lastSale(player).transactionId();
        assertFalse(TransactionService.processTransaction(player, -1).getResult());
        assertFalse(TransactionService.processTransaction(other, transaction).getResult());
        player.gainMeso(-player.getMeso(), false);
        assertFalse(TransactionService.processTransaction(player, transaction).getResult());
        assertFalse(lastSale(player).buybackUsed());
        try (Connection connection = pool.getConnection(); var sql = connection.prepareStatement("UPDATE transactions SET credited_mesos = NULL WHERE transaction_id = ?")) {
            sql.setInt(1, transaction);
            sql.executeUpdate();
        }
        assertFalse(TransactionService.processTransaction(player, transaction).getResult());
        assertFalse(lastSale(player).buybackUsed());
        assertTrue(player.getInventory(InventoryType.USE).list().isEmpty());
    }

    @Test
    void quicksellSkipsProtectedAndZeroValueItemsAndNeverTouchesUnseenSlots() throws Exception {
        Character player = player();
        ItemInformationProvider ii = ItemInformationProvider.getInstance();
        Inventory inventory = player.getInventory(InventoryType.ETC);
        inventory.setSlotLimit(100);
        Item ordinary = new Item(4000000, (short) 1, (short) 2);
        Item quest = new Item(4031000, (short) 2, (short) 1);
        assertTrue(ii.isQuestItem(quest.getItemId()), "The integration fixture must be a real WZ quest item");
        Item zero = new Item(4031439, (short) 3, (short) 1);
        assertEquals(0, TransactionService.getSalePrice(zero));
        assertFalse(ii.isQuestItem(zero.getItemId()));
        Item unseen = new Item(4000000, (short) 97, (short) 7);
        inventory.addItemFromDB(ordinary);
        inventory.addItemFromDB(quest);
        inventory.addItemFromDB(zero);
        inventory.addItemFromDB(unseen);
        List<Item> displayed = player.snapshotItemsForSale(InventoryType.ETC, 1, 96);
        int credit = player.sellAllItemsFromPosition(ii, InventoryType.ETC, 1, 96, displayed);
        assertTrue(credit > 0);
        assertNull(inventory.getItem((short) 1));
        assertSame(quest, inventory.getItem((short) 2));
        assertSame(zero, inventory.getItem((short) 3));
        assertSame(unseen, inventory.getItem((short) 97));
        assertEquals(1, lastSale(player).items().size());
        assertEquals(2, lastSale(player).items().get(0).getQuantity());

        Inventory equipment = player.getInventory(InventoryType.EQUIP);
        Equip cash = null;
        for (int id = 1002000; id < 1002400 && cash == null; id++) {
            if (ii.isCash(id)) {
                cash = (Equip) ii.getEquipById(id);
            }
        }
        assertNotNull(cash, "The WZ fixture must contain a real cash equip");
        cash.setPosition((short) 1);
        equipment.addItemFromDB(cash);
        assertEquals(0, player.sellAllItemsFromPosition(ii, InventoryType.EQUIP, 1, 96));
        assertSame(cash, equipment.getItem((short) 1));
        player.getInventory(InventoryType.CASH).addItemFromDB(new Item(5000000, (short) 1, (short) 1));
        assertEquals(-1, player.sellAllItemsFromPosition(ii, InventoryType.CASH, 1, 96));
        assertNotNull(player.getInventory(InventoryType.CASH).getItem((short) 1));
    }

    @Test
    void staleIdenticalReplacementQuantityAndInvalidRangeCannotSellAnything() throws Exception {
        Character player = player();
        ItemInformationProvider ii = ItemInformationProvider.getInstance();
        Inventory inventory = player.getInventory(InventoryType.USE);
        inventory.addItemFromDB(new Item(2000000, (short) 1, (short) 10));
        List<Item> old = player.snapshotItemsForSale(InventoryType.USE, 1, 96);
        Item replacement = new Item(2000000, (short) 1, (short) 10);
        inventory.addItemFromDB(replacement);
        assertEquals(-1, player.sellAllItemsFromPosition(ii, InventoryType.USE, 1, 96, old));
        assertSame(replacement, inventory.getItem((short) 1));
        List<Item> current = player.snapshotItemsForSale(InventoryType.USE, 1, 96);
        replacement.setQuantity((short) 11);
        assertEquals(-1, player.sellAllItemsFromPosition(ii, InventoryType.USE, 1, 96, current));
        assertEquals(-1, player.sellAllItemsFromPosition(ii, InventoryType.USE, 0, 96));
        assertEquals(-1, player.sellAllItemsFromPosition(ii, InventoryType.USE, 2, 1));
        assertEquals(11, replacement.getQuantity());
        assertTrue(TransactionService.getLastTransactions(player.getId(), 20).isEmpty());
    }

    public static final class ScriptConversation {
        private final Character player;
        private final java.util.List<String> dialogs = new java.util.ArrayList<>();
        private boolean disposed;

        public ScriptConversation(Character player) {
            this.player = player;
        }

        public Character getPlayer() {
            return player;
        }

        public void dispose() {
            disposed = true;
        }

        public void sendSimple(String text) {
            dialogs.add(text);
        }

        public void sendOk(String text) {
            dialogs.add(text);
        }

        public String numberWithCommas(int value) {
            return Integer.toString(value);
        }
    }

    private static final class ScriptLoader extends scripting.AbstractScriptManager {
        javax.script.ScriptEngine load() {
            return getInvocableScriptEngine("npc/9000041.js");
        }
    }

    @Test
    void actualQuicksellScriptCancelsWithoutMutationAndSellsTheDisplayedSelection() throws Exception {
        Character player = player();
        player.getInventory(InventoryType.USE).addItemFromDB(new Item(2000000, (short) 1, (short) 10));
        var engine = new ScriptLoader().load();
        assertNotNull(engine);
        ScriptConversation conversation = new ScriptConversation(player);
        engine.put("cm", conversation);
        var script = (javax.script.Invocable) engine;
        try {
            script.invokeFunction("start");
            script.invokeFunction("action", 1, 0, 2);
            script.invokeFunction("action", 0, 0, 1);
            assertTrue(conversation.disposed);
            assertEquals(10, player.getInventory(InventoryType.USE).getItem((short) 1).getQuantity());
            assertTrue(TransactionService.getLastTransactions(player.getId(), 20).isEmpty());
            script.invokeFunction("start");
            script.invokeFunction("action", 1, 0, 99);
            assertNotNull(player.getInventory(InventoryType.USE).getItem((short) 1));
            assertTrue(TransactionService.getLastTransactions(player.getId(), 20).isEmpty());
            script.invokeFunction("start");
            script.invokeFunction("action", 1, 0, 2);
            script.invokeFunction("action", 1, 0, 1);
            assertNull(player.getInventory(InventoryType.USE).getItem((short) 1));
            assertEquals(10, lastSale(player).items().get(0).getQuantity());
            assertTrue(TransactionService.processTransaction(player, lastSale(player).transactionId()).getResult());
        } finally {
            ((com.oracle.truffle.js.scriptengine.GraalJSScriptEngine) engine).close();
        }
    }

    @Test
    void partialStackSaleCanRedeemIntoCompatibleFullInventory() throws Exception {
        Character player = player();
        Inventory inventory = player.getInventory(InventoryType.USE);
        inventory.setSlotLimit(1);
        Item stack = new Item(2000000, (short) 1, (short) 50);
        stack.setOwner("StackOwner");
        stack.setFlag((short) 1);
        inventory.addItemFromDB(stack);
        shop().sell(player.getClient(), InventoryType.USE, (short) 1, (short) 10);
        Transaction sale = lastSale(player);
        assertEquals(10, sale.items().get(0).getQuantity());
        assertEquals(40, reloadedItems(player).get(0).getLeft().getQuantity());
        var result = TransactionService.processTransaction(player, sale.transactionId());
        assertTrue(result.getResult(), result.getMessage());
        Item restored = reloadedItems(player).get(0).getLeft();
        assertEquals(50, restored.getQuantity());
        assertEquals("StackOwner", restored.getOwner());
        assertEquals(1, restored.getFlag());
        assertEquals(0, reloadedMesos(player));
    }

    @Test
    void saleAndRedemptionConcurrencyKeepsExactImmutableSaleIdentity() throws Exception {
        Character player = player();
        Inventory inventory = player.getInventory(InventoryType.USE);
        inventory.addItemFromDB(new Item(2000000, (short) 1, (short) 10));
        shop().sell(player.getClient(), InventoryType.USE, (short) 1, (short) 10);
        Transaction firstSale = lastSale(player);
        inventory.addItemFromDB(new Item(2000001, (short) 2, (short) 7));
        var gate = new java.util.concurrent.CyclicBarrier(2);
        try (var workers = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var redeem = workers.submit(() -> {
                gate.await();
                return TransactionService.processTransaction(player, firstSale.transactionId());
            });
            var sell = workers.submit(() -> {
                gate.await();
                shop().sell(player.getClient(), InventoryType.USE, (short) 2, (short) 7);
                return true;
            });
            assertTrue(redeem.get().getResult());
            assertTrue(sell.get());
        }
        var rows = TransactionService.getLastTransactions(player.getId(), 20);
        assertEquals(2, rows.size());
        assertTrue(rows.stream().filter(row -> row.transactionId() == firstSale.transactionId()).findFirst().orElseThrow().buybackUsed());
        assertFalse(lastSale(player).buybackUsed());
        assertEquals(lastSale(player).creditedMesos(), reloadedMesos(player));
        var items = reloadedItems(player);
        assertEquals(1, items.size());
        assertEquals(2000000, items.get(0).getLeft().getItemId());
        assertEquals(10, items.get(0).getLeft().getQuantity());
    }

    @Test
    void stockShopPurchaseCannotSpendTheSameBalanceAsBuyback() throws Exception {
        Character player = player();
        Inventory inventory = player.getInventory(InventoryType.USE);
        inventory.addItemFromDB(new Item(2000000, (short) 1, (short) 10));
        shop().sell(player.getClient(), InventoryType.USE, (short) 1, (short) 10);
        Transaction sale = lastSale(player);
        int shopId;
        try (Connection connection = pool.getConnection(); Statement sql = connection.createStatement()) {
            sql.executeUpdate("INSERT INTO shops(npcid) VALUES (9201101)", Statement.RETURN_GENERATED_KEYS);
            try (ResultSet keys = sql.getGeneratedKeys()) {
                assertTrue(keys.next());
                shopId = keys.getInt(1);
            }
            sql.executeUpdate("INSERT INTO shopitems(shopid,itemid,price,pitch,position) VALUES (" + shopId
                    + ",2000001," + sale.creditedMesos() + ",0,1)");
        }
        Shop purchaseShop = Shop.createFromDB(shopId, true);
        assertNotNull(purchaseShop);
        var gate = new java.util.concurrent.CyclicBarrier(2);
        boolean redeemed;
        try (var workers = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var redeem = workers.submit(() -> {
                gate.await();
                return TransactionService.processTransaction(player, sale.transactionId()).getResult();
            });
            var buy = workers.submit(() -> {
                gate.await();
                purchaseShop.buy(player.getClient(), (short) 0, 2000001, (short) 1);
                return true;
            });
            redeemed = redeem.get();
            assertTrue(buy.get());
        }
        assertEquals(0, player.getMeso());
        assertEquals(redeemed ? 10 : 0, inventory.countById(2000000));
        assertEquals(redeemed ? 0 : 1, inventory.countById(2000001));
        assertEquals(redeemed, lastSale(player).buybackUsed());
    }
}

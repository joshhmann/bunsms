import client.Client;
import client.creator.veteran.WarriorCreator;
import config.YamlConfig;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import net.PacketProcessor;
import net.packet.OutPacket;
import net.server.Server;

import java.io.ByteArrayOutputStream;
import java.net.Socket;
import java.nio.file.*;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/** CI fixture setup only. Native credentials/PIC/selection remain real, separate consumers. */
public final class NativeDailyFixtureBackend {
    private static final String JAR_SHA = "63790903a2cd8f59664764fb7af8c2583313e422a404f8269005191aeb579503";
    private static final String NAME = "WinDailyQa";
    private static void require(boolean ok, String message) {
        if (!ok) throw new IllegalStateException(message);
    }
    private static String sha(Path p) throws Exception {
        var digest = MessageDigest.getInstance("SHA-256");
        try (var in = Files.newInputStream(p)) {
            byte[] block = new byte[65536];
            for (int n; (n = in.read(block)) >= 0;) digest.update(block, 0, n);
        }
        return HexFormat.of().formatHex(digest.digest());
    }
    private static Connection db() throws SQLException {
        var cfg = YamlConfig.config.server;
        return DriverManager.getConnection(String.format(cfg.DB_URL_FORMAT, "127.0.0.1"), cfg.DB_USER, cfg.DB_PASS);
    }
    private static String rowHash(Connection db, String sql, boolean omitNxCredit) throws Exception {
        var digest = MessageDigest.getInstance("SHA-256");
        var length = java.nio.ByteBuffer.allocate(Integer.BYTES);
        try (var q = db.createStatement(); var r = q.executeQuery(sql)) {
            require(r.next(), "Required original fixture row absent");
            for (int i = 1; i <= r.getMetaData().getColumnCount(); i++) {
                if (omitNxCredit && r.getMetaData().getColumnLabel(i).equalsIgnoreCase("nxCredit")) continue;
                byte[] value = r.getBytes(i);
                length.clear();
                digest.update(length.putInt(value == null ? -1 : value.length).array());
                if (value != null) digest.update(value);
            }
            require(!r.next(), "Fixture row identity is not unique");
        }
        return HexFormat.of().formatHex(digest.digest());
    }
    private static String json(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", "\\r").replace("\n", "\\n") + "\"";
    }
    private static int initializeCashPrism(Client context, int character, int account) throws Exception {
        client.Character player = client.Character.loadCharFromDB(character, context, true);
        require(player != null && player.getLevel() == 30 && player.getJob().getId() == 100
                && player.gmLevel() == 0 && context.getPlayer() == null && context.getCapsMask() == 0,
                "Unexpected normal pre-auth Warrior context");
        var cash = player.getInventory(client.inventory.InventoryType.CASH);
        require(cash.countById(5782000) == 0, "Prism fixture must start without a prism");
        require(client.inventory.manipulator.InventoryManipulator.addByIdForCharacter(player, 5782000, (short) 1),
                "Normal inventory API refused genuine Prism5782000");
        int slot = cash.findById(5782000).getPosition();
        require(cash.countById(5782000) == 1 && slot > 0, "Normal prism grant differs");
        List<tools.Pair<client.inventory.Item, client.inventory.InventoryType>> items = new ArrayList<>();
        for (var type : client.inventory.InventoryType.values()) {
            if (type == client.inventory.InventoryType.UNDEFINED || type == client.inventory.InventoryType.CANHOLD) continue;
            var inventory = player.getInventory(type);
            if (inventory != null) for (var item : inventory.list()) items.add(new tools.Pair<>(item, type));
        }
        try (var connection = db()) {
            connection.setAutoCommit(false);
            boolean committed = false;
            try {
                try (var update = connection.prepareStatement(
                        "UPDATE accounts SET nxCredit=10000 WHERE id=? AND nxCredit=0 AND loggedin=0")) {
                    update.setInt(1, account);
                    require(update.executeUpdate() == 1, "Expected genuinely offline zero-NX fixture account changed");
                }
                client.inventory.ItemFactory.INVENTORY.saveItems(items, character, connection);
                connection.commit();
                committed = true;
            } finally {
                if (!committed) connection.rollback();
            }
        }
        client.Character reloaded = client.Character.loadCharFromDB(character, context, true);
        var restored = reloaded.getInventory(client.inventory.InventoryType.CASH);
        require(reloaded.gmLevel() == 0 && reloaded.getLevel() == 30 && reloaded.getJob().getId() == 100
                && restored.countById(5782000) == 1 && restored.findById(5782000).getPosition() == slot
                && reloaded.getCashShop().getCash(server.CashShop.NX_CREDIT) == 10000,
                "Normal persisted fixture reload lost exact credit/prism/role identity");
        return slot;
    }
    private static void publishReady(Path target, String data) throws Exception {
        Path temporary = Files.createTempFile(target.getParent(), ".daily-fixture-ready-", ".json");
        try {
            Files.writeString(temporary, data, StandardOpenOption.TRUNCATE_EXISTING);
            require(!Files.exists(target, LinkOption.NOFOLLOW_LINKS), "Ready receipt already exists");
            Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }
    public static void main(String[] args) {
        try {
            require(args.length == 4 || (args.length == 5 && "cash-prism-preauth".equals(args[4])),
                    "Expected MySQL UUID, receipt, PRIVATE credentials, producer source and optional cash-prism-preauth");
            final boolean funded = args.length == 5;
            String uuid = args[0].toLowerCase(Locale.ROOT);
            require(uuid.matches("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"), "Invalid expected owned MySQL identity");
            Path receipt = Path.of(args[1]).toAbsolutePath().normalize();
            Path credentials = Path.of(args[2]).toAbsolutePath().normalize();
            Path source = Path.of(args[3]).toAbsolutePath().normalize();
            require(!credentials.startsWith(receipt.getParent()), "Credentials must be outside uploaded backend output");
            require(!Files.exists(receipt) && !Files.exists(credentials), "Refuse to overwrite previous fixture evidence or credentials");
            require(Files.isRegularFile(source), "Pinned producer source is required");
            Path jar = Path.of(Server.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            require(Files.isRegularFile(jar) && sha(jar).equals(JAR_SHA), "Wrong matched gameplay JAR");
            var cfg = YamlConfig.config.server;
            require("jdbc:mysql://%s:3306/buns_rc".equals(cfg.DB_URL_FORMAT) && "buns_rc".equals(cfg.DB_USER), "Only the dedicated CI schema/principal is allowed");
            require("127.0.0.1".equals(cfg.DB_HOST) && "127.0.0.1".equals(cfg.HOST) && "127.0.0.1".equals(cfg.LANHOST), "Only loopback CI configuration is allowed");
            require(System.getenv("DB_HOST") == null || "127.0.0.1".equals(System.getenv("DB_HOST")), "Unexpected DB host environment override");
            try (var c = db(); var q = c.createStatement(); var r = q.executeQuery("SELECT DATABASE(), @@server_uuid")) {
                require(r.next() && "buns_rc".equals(r.getString(1)) && uuid.equals(r.getString(2)), "Wrong owned CI database/UUID");
            }
            // The real server performs its normal migrations, resources, bots and listeners.
            Server.main(new String[0]);
            // Factory slot checks use the normal SQL-backed character view, not raw SQL row counts.
            // Populate it through the existing read-only server API without a login-state transition.
            Server.getInstance().loadAllAccountsCharactersView();
            int account, gender, slots, nxBefore;
            int cashSlot = 0;
            String accountBefore, accountInvariantBefore, templateBefore, pic;
            try (var c = db(); var q = c.createStatement(); var r = q.executeQuery("SELECT id, gender, characterslots, loggedin, pic, nxCredit FROM accounts WHERE name='fmbot'")) {
                require(r.next() && r.getInt("loggedin") == 0, "Seed account must genuinely be offline; never repair login flags");
                account = r.getInt("id"); gender = r.getInt("gender"); slots = r.getInt("characterslots"); pic = r.getString("pic");
                nxBefore = r.getInt("nxCredit");
                require(!funded || nxBefore == 0, "Funded fixture requires the genuinely zero-NX starting seed");
                require(gender == 0 && slots > 1 && slots <= Byte.MAX_VALUE && pic != null && pic.matches("[0-9]{6}"), "Unexpected genuine starter account policy");
                require(!r.next(), "Seed account identity collision");
                accountBefore = rowHash(c, "SELECT * FROM accounts WHERE name='fmbot'", false);
                accountInvariantBefore = rowHash(c, "SELECT * FROM accounts WHERE name='fmbot'", true);
                templateBefore = rowHash(c, "SELECT * FROM characters WHERE id=2", false);
                try (var collision = c.createStatement(); var rows = collision.executeQuery("SELECT COUNT(*) FROM characters WHERE name='" + NAME + "'")) {
                    require(rows.next() && rows.getInt(1) == 0, "Existing fixture name is not a fresh producer run");
                }
            }
            var acceptors = new NioEventLoopGroup(1);
            var transports = new NioEventLoopGroup(1);
            var ready = new CompletableFuture<Client>();
            var accepted = new CompletableFuture<Channel>();
            var bytes = new ByteArrayOutputStream();
            String orderedCharacters;
            int targetIndex;
            Channel listener = null;
            try {
                listener = new ServerBootstrap().group(acceptors, transports).channel(NioServerSocketChannel.class)
                    .childHandler(new ChannelInitializer<SocketChannel>() {
                        @Override protected void initChannel(SocketChannel ch) {
                            accepted.complete(ch);
                            Client context = funded
                                    ? Client.createChannelClient(System.nanoTime(), "127.0.0.1", PacketProcessor.getChannelServerProcessor(0, 1), 0, 1)
                                    : Client.createLoginClient(System.nanoTime(), "127.0.0.1", PacketProcessor.getLoginServerProcessor(), 0, -1);
                            ch.pipeline().addLast("actual-factory-output", new ChannelOutboundHandlerAdapter() {
                                @Override public void write(ChannelHandlerContext ctx, Object msg, ChannelPromise promise) throws Exception {
                                    require(msg instanceof OutPacket, "Unexpected factory transport message");
                                    byte[] frame = ((OutPacket) msg).getBytes();
                                    synchronized (bytes) { bytes.write(frame); }
                                    ctx.write(Unpooled.wrappedBuffer(frame), promise);
                                }
                            });
                            ch.pipeline().addLast("factory-context-ready", new ChannelInboundHandlerAdapter() {
                                @Override public void channelActive(ChannelHandlerContext ctx) {
                                    ctx.fireChannelActive();
                                    ready.complete(context);
                                }
                            });
                            ch.pipeline().addLast("real-client", context);
                        }
                    }).bind("127.0.0.1", 0).sync().channel();
                try (var socket = new Socket()) {
                    socket.connect(listener.localAddress()); socket.setSoTimeout(10000);
                    Client context = ready.get(10, TimeUnit.SECONDS);
                    // This is offline fixture ownership, not a login or a session-state transition.
                    context.setAccID(account); context.setAccountName("fmbot"); context.setCharacterSlots((byte) slots);
                    require(context.getPlayer() == null && context.getCapsMask() == 0, "Factory context must not impersonate a logged-in player");
                    try {
                        int result = WarriorCreator.createCharacter(context, NAME, 20000, 30030, 0, gender, 0);
                        require(result == 0, "Existing validated Warrior factory refused the fixture: " + result);
                        List<client.Character> chooser = context.loadCharacters(0);
                        var ordered = new StringJoiner(",", "[", "]");
                        targetIndex = -1;
                        for (int i = 0; i < chooser.size(); i++) {
                            var entry = chooser.get(i);
                            ordered.add("{\"id\":" + entry.getId() + ",\"name\":" + json(entry.getName()) + "}");
                            if (NAME.equals(entry.getName())) {
                                require(targetIndex == -1, "Duplicate target in actual chooser view");
                                targetIndex = i;
                            }
                        }
                        require(targetIndex >= 0, "Actual chooser API does not contain the new normal character");
                        orderedCharacters = ordered.toString();
                        if (funded) cashSlot = initializeCashPrism(context, chooser.get(targetIndex).getId(), account);
                    } finally {
                        context.setAccID(0); // Detach fixture ownership before ordinary transport teardown.
                    }
                    accepted.get(10, TimeUnit.SECONDS).eventLoop().submit(() -> {}).sync();
                    byte[] expected;
                    synchronized (bytes) { expected = bytes.toByteArray(); }
                    require(expected.length > 0 && Arrays.equals(socket.getInputStream().readNBytes(expected.length), expected), "Real factory packet delivery did not match");
                }
            } finally {
                if (listener != null) listener.close().sync();
                acceptors.shutdownGracefully().sync(); transports.shutdownGracefully().sync();
            }
            int character;
            try (var c = db()) {
                require((funded ? accountInvariantBefore.equals(rowHash(c, "SELECT * FROM accounts WHERE name='fmbot'", true))
                                : accountBefore.equals(rowHash(c, "SELECT * FROM accounts WHERE name='fmbot'", false))),
                        "Factory setup changed account fields beyond the explicitly allowed pre-auth NX delta");
                require(templateBefore.equals(rowHash(c, "SELECT * FROM characters WHERE id=2", false)), "Factory setup changed CID2");
                try (var q = c.createStatement(); var r = q.executeQuery("SELECT nxCredit,loggedin FROM accounts WHERE id=" + account)) {
                    require(r.next() && r.getInt(1) == (funded ? 10000 : nxBefore) && r.getInt(2) == 0 && !r.next(),
                            "Expected exact pre-auth credit/offline state differs");
                }
                try (var q = c.createStatement(); var r = q.executeQuery("SELECT id,accountid,world,map,level,job,gm FROM characters WHERE name='" + NAME + "'")) {
                    require(r.next() && r.getInt("accountid") == account && r.getInt("world") == 0 && r.getInt("map") == 102000000 && r.getInt("level") == 30 && r.getInt("job") == 100 && r.getInt("gm") == 0, "Persisted normal Warrior recipe differs");
                    character = r.getInt("id"); require(character != 2 && !r.next(), "Invalid second-character identity");
                }
            }
            String seed;
            try (var in = NativeDailyFixtureBackend.class.getResourceAsStream("/db/data/162-fmbot-data.sql")) {
                require(in != null, "Actual starter-account source resource absent"); seed = new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            }
            var password = Pattern.compile("(?m)^-- Login: fmbot / ([^\\r\\n]+)$").matcher(seed);
            require(password.find(), "Actual starter credential source is not identifiable");
            Files.createDirectories(credentials.getParent());
            Files.writeString(credentials, "{\"username\":\"fmbot\",\"password\":" + json(password.group(1)) + ",\"pic\":" + json(pic) + ",\"character\":\"" + NAME + "\"}\n", StandardOpenOption.CREATE_NEW);
            String accountIntegrity = "\"allOriginalFieldsUnchanged\":" + !funded
                    + ",\"authenticationFieldsUnchanged\":true,\"allowedAccountDeltasExact\":true,\"allowedAccountDeltas\":"
                    + (funded ? "{\"nxCredit\":{\"before\":0,\"after\":10000}}" : "{}");
            String featureFixture = funded
                    ? ",\"funding\":{\"origin\":\"FIXTURE_PRE_AUTH_NOT_EARNED\",\"currency\":\"NX_CREDIT\",\"before\":0,\"after\":10000}"
                    + ",\"ownedPrism\":{\"origin\":\"FIXTURE_PRE_AUTH_NOT_OBTAINED\",\"itemId\":5782000,\"quantity\":1,\"actualCashSlot\":"
                    + cashSlot + ",\"normalInventoryApiPersistedAndReloaded\":true}"
                    : "";
            publishReady(receipt, "{\"status\":\"PASS_GENUINE_WARRIOR_FACTORY_SETUP_NOT_NATIVE_AUTH_OR_FEATURE_ACCEPTANCE\",\"fixtureKind\":"
                    + json(funded ? "CASH_PRISM_PREAUTH" : "DAILY_EXISTING_UNFUNDED_SEED")
                    + ",\"account\":{\"id\":" + account + ",\"name\":\"fmbot\",\"loggedinBefore\":0,\"loggedinAfter\":0," + accountIntegrity
                    + "},\"character\":{\"id\":" + character + ",\"name\":\"" + NAME + "\",\"world\":0,\"map\":102000000,\"level\":30,\"job\":100,\"gm\":0},\"orderedCharacters\":"
                    + orderedCharacters + ",\"targetZeroBasedIndex\":" + targetIndex
                    + ",\"chooserEvidence\":\"actual Client.loadCharacters(0), not an ID or SQL-order assumption\",\"cid2Unchanged\":true,\"mysqlUuid\":"
                    + json(uuid) + ",\"schema\":\"buns_rc\",\"gameplaySourceCommit\":\"8b2110fff89b6d659b31aac360cb6881f5e4f3c2\",\"jarSha256\":\""
                    + JAR_SHA + "\",\"producerSourceSha256\":" + json(sha(source)) + ",\"realFactoryPacketBytes\":" + bytes.size()
                    + ",\"normalServerRemainsRunning\":true,\"nativeAuthPicSelectionClaimRelogStillRequired\":true" + featureFixture + "}\n");
            System.out.println("NATIVE_DAILY_FIXTURE_READY normal factory character WinDailyQa; native authentication/feature acceptance remain separate");
        } catch (Throwable failure) {
            failure.printStackTrace();
            System.exit(1);
        }
    }
}

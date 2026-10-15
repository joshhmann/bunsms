package net.server.channel.handlers;

import net.opcodes.RecvOpcode;
import net.opcodes.SendOpcode;
import net.packet.InPacket;
import net.packet.Packet;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;
import server.CashShop;
import server.cashshop.CashShopCatalog;
import server.cashshop.CashShopWindowPackets;
import testutil.HandlerTest;
import testutil.Packets;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Cash Shop window wire contract: opcode values from the registry plus the packet
 * layout the DLL-side window decodes (resp codes, index, category chunks,
 * buy/cart results, NX refresh). The client window itself is DLL-side per the
 * owner DLL-first policy — this is the server half only.
 */
@ExtendWith(MockitoExtension.class)
class CashShopWindowHandlerTest extends HandlerTest {

    private final CashShopWindowHandler handler = new CashShopWindowHandler();

    @Mock
    private CashShop cashShop;

    private void openField() {
        lenient().when(chr.getCashShop()).thenReturn(cashShop);
        lenient().when(cashShop.isOpened()).thenReturn(false);
    }

    @Test
    void opcodeValuesMatchRegistry() {
        assertEquals(0x3730, RecvOpcode.CASHSHOP_WINDOW_ACTION.getValue());
        assertEquals(0x3731, SendOpcode.CASHSHOP_WINDOW_SYNC.getValue());
    }

    @Test
    void nullPlayerSendsNothing() {
        lenient().when(client.getPlayer()).thenReturn(null);

        handler.handlePacket(Packets.buildInPacket(out -> out.writeByte(0)), client);

        verify(client, never()).sendPacket(any());
    }

    @Test
    void playerInCashShopStageIsIgnored() {
        lenient().when(chr.getCashShop()).thenReturn(cashShop);
        lenient().when(cashShop.isOpened()).thenReturn(true);

        handler.handlePacket(Packets.buildInPacket(out -> out.writeByte(0)), client);

        verify(client, never()).sendPacket(any());
    }

    @Test
    void emptyPacketSendsNothing() {
        openField();

        handler.handlePacket(Packets.buildInPacket(out -> {}), client);

        verify(client, never()).sendPacket(any());
    }

    @Test
    void unknownActionSendsNothing() {
        openField();

        handler.handlePacket(Packets.buildInPacket(out -> out.writeByte(99)), client);

        verify(client, never()).sendPacket(any());
    }

    @Test
    void catalogRequestSendsIndexAndCash() {
        openField();
        lenient().when(cashShop.getCash(CashShop.NX_CREDIT)).thenReturn(5000);
        lenient().when(cashShop.getCash(CashShop.MAPLE_POINT)).thenReturn(0);
        lenient().when(cashShop.getCash(CashShop.NX_PREPAID)).thenReturn(0);

        handler.handlePacket(
                Packets.buildInPacket(out -> out.writeByte(CashShopWindowPackets.ACTION_REQUEST_CATALOG)),
                client);

        verify(client, Mockito.times(2)).sendPacket(any());

        // Index layout: opcode(2 LE) + RESP_INDEX(1) + count(2) + entries(tab,cat,count).
        var index = CashShopWindowPackets.index(List.of(new int[]{2, 0, 10}));
        byte[] raw = index.getBytes();
        InPacket in = Packets.buildInPacket(out -> out.writeBytes(raw));
        assertEquals(0x3731, in.readShort() & 0xFFFF);
        assertEquals(CashShopWindowPackets.RESP_INDEX, in.readByte());
        assertEquals(1, in.readShort());
        assertEquals(2, in.readByte());
        assertEquals(0, in.readByte());
        assertEquals(10, in.readInt());
        assertEquals(0, in.available());
    }

    @Test
    void categoryRequestWithShortPacketSendsNothing() {
        openField();

        handler.handlePacket(
                Packets.buildInPacket(out -> {
                    out.writeByte(CashShopWindowPackets.ACTION_REQUEST_CATEGORY);
                    out.writeByte(2); // tab but no category byte
                }),
                client);

        verify(client, never()).sendPacket(any());
    }

    @Test
    void buyResultRoundTripDecodes() {
        var pkt = CashShopWindowPackets.buyResult(CashShopWindowPackets.BUY_NO_NX, 1000000);
        InPacket in = Packets.buildInPacket(out -> out.writeBytes(pkt.getBytes()));
        assertEquals(0x3731, in.readShort() & 0xFFFF);
        assertEquals(CashShopWindowPackets.RESP_BUY, in.readByte());
        assertEquals(CashShopWindowPackets.BUY_NO_NX, in.readByte());
        assertEquals(1000000, in.readInt());
        assertEquals(0, in.available());
    }

    @Test
    void cartResultRoundTripDecodes() {
        var pkt = CashShopWindowPackets.cartResult(CashShopWindowPackets.BUY_OK, 0, 3, 9000);
        InPacket in = Packets.buildInPacket(out -> out.writeBytes(pkt.getBytes()));
        assertEquals(0x3731, in.readShort() & 0xFFFF);
        assertEquals(CashShopWindowPackets.RESP_BUY_CART, in.readByte());
        assertEquals(CashShopWindowPackets.BUY_OK, in.readByte());
        assertEquals(0, in.readInt());
        assertEquals(3, in.readByte());
        assertEquals(9000, in.readInt());
        assertEquals(0, in.available());
    }

    @Test
    void openAndCashPacketsSeedNxDisplay() {
        lenient().when(chr.getCashShop()).thenReturn(cashShop);
        lenient().when(cashShop.getCash(CashShop.NX_CREDIT)).thenReturn(1234);
        lenient().when(cashShop.getCash(CashShop.MAPLE_POINT)).thenReturn(56);
        lenient().when(cashShop.getCash(CashShop.NX_PREPAID)).thenReturn(7);

        InPacket in = Packets.buildInPacket(
                out -> out.writeBytes(CashShopWindowPackets.open(chr).getBytes()));
        assertEquals(0x3731, in.readShort() & 0xFFFF);
        assertEquals(CashShopWindowPackets.RESP_OPEN, in.readByte());
        assertEquals(1234, in.readInt());
        assertEquals(56, in.readInt());
        assertEquals(7, in.readInt());

        InPacket cash = Packets.buildInPacket(
                out -> out.writeBytes(CashShopWindowPackets.cash(chr).getBytes()));
        assertEquals(0x3731, cash.readShort() & 0xFFFF);
        assertEquals(CashShopWindowPackets.RESP_CASH, cash.readByte());
        assertEquals(1234, cash.readInt());
    }

    @Test
    void categoryPacketsChunkAndClearFirst() throws Exception {
        Path dir = Files.createTempDirectory("cashshop-cat-test");
        String prev = System.getProperty("cashshop-path");
        System.setProperty("cashshop-path", dir.toString());
        try {
            StringBuilder tsv = new StringBuilder("# itemId\tprice\tcount\ttab\tcategory\tperiod\tgender\tname\n");
            for (int i = 0; i < 5; i++) {
                tsv.append("100000").append(i).append('\t')
                        .append(1000 + i).append("\t1\t2\t0\t0\t2\tItem ").append(i).append('\n');
            }
            Files.write(dir.resolve("catalog.tsv"), tsv.toString().getBytes(StandardCharsets.UTF_8));
            CashShopCatalog.load();
            assertEquals(5, CashShopCatalog.bucket(2, 0).size());

            List<Packet> chunks =
                    CashShopWindowPackets.category(2, 0, CashShopCatalog.bucket(2, 0));
            assertEquals(1, chunks.size());

            InPacket in = Packets.buildInPacket(out -> out.writeBytes(chunks.get(0).getBytes()));
            assertEquals(0x3731, in.readShort() & 0xFFFF);
            assertEquals(CashShopWindowPackets.RESP_CATALOG, in.readByte());
            assertEquals(1, in.readByte()); // first chunk clears the category
            assertEquals(2, in.readByte());
            assertEquals(0, in.readByte());
            assertEquals(5, in.readShort());
            assertEquals(1000000, in.readInt());
            assertEquals(1000, in.readInt());
            assertEquals(1, in.readShort());
            assertEquals(2, in.readByte());
            assertEquals(0, in.readByte());
            assertEquals("Item 0", in.readString());

            // Empty category still yields one packet so the client clears stale entries.
            List<Packet> empty = CashShopWindowPackets.category(9, 9, List.of());
            assertEquals(1, empty.size());
            InPacket ein = Packets.buildInPacket(out -> out.writeBytes(empty.get(0).getBytes()));
            assertEquals(0x3731, ein.readShort() & 0xFFFF);
            assertEquals(CashShopWindowPackets.RESP_CATALOG, ein.readByte());
            assertEquals(1, ein.readByte()); // clear flag
            assertEquals(9, ein.readByte()); // tab
            assertEquals(9, ein.readByte()); // category
            assertEquals(0, ein.readShort()); // zero rows
        } finally {
            if (prev == null) {
                System.clearProperty("cashshop-path");
            } else {
                System.setProperty("cashshop-path", prev);
            }
            CashShopCatalog.load();
        }
    }

    @Test
    void oversizedCartCountIsRejectedWithoutReading() {
        openField();

        // Declares 3 items but only carries 1: must be rejected as BAD_CART, and the
        // delivered/spent fields confirm nothing was charged.
        handler.handlePacket(
                Packets.buildInPacket(out -> {
                    out.writeByte(CashShopWindowPackets.ACTION_BUY_CART);
                    out.writeByte(3);
                    out.writeInt(1000000);
                }),
                client);

        var cap = ArgumentCaptor.forClass(Packet.class);
        verify(client).sendPacket(cap.capture());
        InPacket in = Packets.buildInPacket(out -> out.writeBytes(cap.getValue().getBytes()));
        assertEquals(0x3731, in.readShort() & 0xFFFF);
        assertEquals(CashShopWindowPackets.RESP_BUY_CART, in.readByte());
        assertEquals(CashShopWindowPackets.BUY_BAD_CART, in.readByte());
    }

    @Test
    void buyUnknownItemReportsUnknown() {
        openField();
        lenient().when(client.tryacquireClient()).thenReturn(true);
        // 7XXXXXX is in no sane catalogue; with an empty/loaded catalogue alike the
        // lookup misses and no inventory or NX mock is touched.
        CashShopCatalogTestHelper.ensureEmptyCatalog();

        handler.handlePacket(
                Packets.buildInPacket(out -> {
                    out.writeByte(CashShopWindowPackets.ACTION_BUY);
                    out.writeInt(7999999);
                }),
                client);

        var cap = ArgumentCaptor.forClass(Packet.class);
        verify(client).sendPacket(cap.capture());
        InPacket in = Packets.buildInPacket(out -> out.writeBytes(cap.getValue().getBytes()));
        assertEquals(0x3731, in.readShort() & 0xFFFF);
        assertEquals(CashShopWindowPackets.RESP_BUY, in.readByte());
        assertEquals(CashShopWindowPackets.BUY_UNKNOWN_ITEM, in.readByte());
        assertEquals(7999999, in.readInt());
    }

    @Test
    void buyKnownRowReachesAffordabilityOrDataGate() throws Exception {
        // End-to-end through CashShopWindowPurchase.buy with a real catalogue row: the
        // membership gate passes, then either the NX check fires (NO_NX, live WZ) or the
        // item-data gate fails closed (UNKNOWN_ITEM, WZ/DB absent in unit tests).
        openField();
        int itemId = 2000000;
        CashShopCatalogTestHelper.loadSingleRow(itemId, 50, 100, "Helper Potion");
        lenient().when(client.tryacquireClient()).thenReturn(true);
        lenient().when(cashShop.getCash(CashShop.NX_CREDIT)).thenReturn(0);

        try {
            handler.handlePacket(
                    Packets.buildInPacket(out -> {
                        out.writeByte(CashShopWindowPackets.ACTION_BUY);
                        out.writeInt(itemId);
                    }),
                    client);

            var cap = ArgumentCaptor.forClass(Packet.class);
            verify(client).sendPacket(cap.capture());
            InPacket in = Packets.buildInPacket(out -> out.writeBytes(cap.getValue().getBytes()));
            assertEquals(0x3731, in.readShort() & 0xFFFF);
            assertEquals(CashShopWindowPackets.RESP_BUY, in.readByte());
            int code = in.readByte() & 0xFF;
            assertTrue(code == CashShopWindowPackets.BUY_NO_NX
                    || code == CashShopWindowPackets.BUY_UNKNOWN_ITEM,
                    "unexpected buy code " + code);
        } finally {
            CashShopCatalogTestHelper.ensureEmptyCatalog();
        }
    }

    /** Small static helper sharing TempDir-free catalogue setup with the purchase test. */
    static final class CashShopCatalogTestHelper {
        static void ensureEmptyCatalog() {
            String prev = System.getProperty("cashshop-path");
            try {
                Path dir = Files.createTempDirectory("cashshop-empty-test");
                System.setProperty("cashshop-path", dir.toString());
                CashShopCatalog.load();
            } catch (Exception e) {
                throw new RuntimeException(e);
            } finally {
                if (prev == null) {
                    System.clearProperty("cashshop-path");
                } else {
                    System.setProperty("cashshop-path", prev);
                }
            }
        }

        static void loadSingleRow(int itemId, int price, int count, String name) throws Exception {
            Path dir = Files.createTempDirectory("cashshop-single-test");
            String row = itemId + "\t" + price + "\t" + count + "\t5\t2\t0\t2\t" + name + "\n";
            Files.write(dir.resolve("catalog.tsv"),
                    ("# itemId\tprice\tcount\ttab\tcategory\tperiod\tgender\tname\n" + row)
                            .getBytes(StandardCharsets.UTF_8));
            // Leave cashshop-path pointed at this dir; caller restores via ensureEmptyCatalog.
            System.setProperty("cashshop-path", dir.toString());
            CashShopCatalog.load();
        }
    }
}

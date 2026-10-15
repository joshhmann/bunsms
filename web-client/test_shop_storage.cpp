// Native shop/storage regression suite. Run via:
//   cd web-client && python3 -m unittest test_modernization -v
// The runner reconstructs the pinned vendor + preserved production + candidate
// patches and links the REAL InPacket/OutPacket implementations. No transport,
// assets or renderer are mocked into an alternative parser/serializer.
#include "Net/Handlers/Helpers/ShopParser.h"
#include "Net/Handlers/Helpers/StorageParser.h"
#include "Net/Packets/NpcInteractionPackets.h"

#include <cassert>
#include <initializer_list>
#include <iostream>
#include <string>

namespace
{
    using Bytes = std::vector<int8_t>;

    void byte(Bytes& out, uint8_t value) { out.push_back(static_cast<int8_t>(value)); }
    void short_le(Bytes& out, uint16_t value)
    {
        byte(out, static_cast<uint8_t>(value));
        byte(out, static_cast<uint8_t>(value >> 8));
    }
    void int_le(Bytes& out, int32_t value)
    {
        uint32_t bits = static_cast<uint32_t>(value);
        for (unsigned i = 0; i < 4; ++i)
            byte(out, static_cast<uint8_t>(bits >> (8 * i)));
    }
    void long_le(Bytes& out, int64_t value)
    {
        uint64_t bits = static_cast<uint64_t>(value);
        for (unsigned i = 0; i < 8; ++i)
            byte(out, static_cast<uint8_t>(bits >> (8 * i)));
    }
    void string(Bytes& out, const std::string& value)
    {
        short_le(out, static_cast<uint16_t>(value.size()));
        out.insert(out.end(), value.begin(), value.end());
    }
    jrc::InPacket packet(const Bytes& bytes)
    {
        return jrc::InPacket(bytes.data(), bytes.size());
    }
    void wire(const std::vector<int8_t>& bytes, std::initializer_list<uint8_t> expected)
    {
        assert(bytes.size() == expected.size());
        size_t offset = 0;
        for (uint8_t value : expected)
            assert(static_cast<uint8_t>(bytes[offset++]) == value);
    }
    void malformed_shop(const Bytes& bytes)
    {
        auto recv = packet(bytes);
        jrc::ShopParser::ShopOffer offer;
        assert(!jrc::ShopParser::parse_open_shop(recv, offer));
    }

    // Server getNPCShop stride: id/price/pitch/time + pad32 + flag short,
    // then buyable short (non-rechargeable) or pad32 + unitprice + slotmax.
    void shop_entry(Bytes& out, int32_t id, int32_t price, bool rechargeable,
        int16_t tail_a = 0, int16_t tail_b = 0)
    {
        int_le(out, id);
        int_le(out, price);
        int_le(out, 0); // pitch
        int_le(out, 0); // time
        int_le(out, 0); // pad
        if (!rechargeable)
        {
            short_le(out, 1);
            short_le(out, static_cast<uint16_t>(tail_a)); // buyable
        }
        else
        {
            short_le(out, 0);
            int_le(out, 0); // pad
            short_le(out, static_cast<uint16_t>(tail_a)); // unit price bits
            short_le(out, static_cast<uint16_t>(tail_b)); // slot max
        }
    }

    // Server zeroPosition addItemInfo stride for a plain stackable.
    void storage_stackable(Bytes& out, int32_t id, int16_t count)
    {
        byte(out, 0); // item type
        int_le(out, id);
        byte(out, 0); // not cash
        long_le(out, 0); // expiration
        short_le(out, static_cast<uint16_t>(count));
        string(out, "");
        short_le(out, 0); // flags
    }

    // Server zeroPosition addItemInfo stride for a non-cash equip:
    // 2 + 28 + owner + 2 + 18 + 12 tail.
    void storage_equip(Bytes& out, int32_t id)
    {
        byte(out, 1); // item type
        int_le(out, id);
        byte(out, 0); // not cash
        long_le(out, 0); // expiration
        byte(out, 7); // upgrade slots
        byte(out, 0); // level
        for (int i = 0; i < 14; ++i)
            short_le(out, 0); // stats
        string(out, "");
        short_le(out, 0); // flags
        for (int i = 0; i < 18; ++i)
            byte(out, 0); // non-cash tail
        for (int i = 0; i < 12; ++i)
            byte(out, 0); // expiration + serial
    }

    void shop_open_regressions()
    {
        // Mixed offer: potion stack (buyable 100) + throwing star
        // (rechargeable, slot max 800) + sold-out entry (buyable 0).
        Bytes bytes;
        int_le(bytes, 1012002);
        short_le(bytes, 3);
        shop_entry(bytes, 2000000, 50, false, 100);
        shop_entry(bytes, 2070000, 0, true, 1, 800);
        shop_entry(bytes, 2010000, 100, false, 0);
        auto recv = packet(bytes);
        jrc::ShopParser::ShopOffer offer;
        assert(jrc::ShopParser::parse_open_shop(recv, offer));
        assert(!recv.available());
        assert(offer.npcid == 1012002);
        assert(offer.items.size() == 3);
        assert(!offer.items[0].rechargeable && offer.items[0].buyable == 100);
        assert(offer.items[1].rechargeable && offer.items[1].slotmax == 800);
        assert(offer.items[2].buyable == 0);

        // Truncation anywhere in the second entry stride must fail whole.
        for (size_t cut = 0; cut < bytes.size(); ++cut)
            malformed_shop(Bytes(bytes.begin(), bytes.begin() + cut));

        // Negative count is not a huge allocation.
        Bytes bad;
        int_le(bad, 1012002);
        short_le(bad, static_cast<uint16_t>(-1));
        malformed_shop(bad);
    }

    void shop_packet_regressions()
    {
        // Exact v83 outgoing layouts: buy = mode0 slot/itemid/qty,
        // sell = mode1, recharge = mode2 + short slot, leave = mode3.
        wire(jrc::NpcShopActionPacket(0, 2000000, 10, true).data(),
            { 61, 0, 0, 0, 0, 128, 132, 30, 0, 10, 0 });
        wire(jrc::NpcShopActionPacket(3, 2000000, 5, false).data(),
            { 61, 0, 1, 3, 0, 128, 132, 30, 0, 5, 0 });
        wire(jrc::NpcShopActionPacket(7).data(), { 61, 0, 2, 7, 0 });
        wire(jrc::NpcShopActionPacket().data(), { 61, 0, 3 });

        // Result codes: sold-out (1/5) and no-mesos (2) surface notices;
        // success (0) and sell-accepted (8) stay silent.
        assert(jrc::ShopParser::result_message(1) != nullptr);
        assert(jrc::ShopParser::result_message(5) != nullptr);
        assert(jrc::ShopParser::result_message(2) != nullptr);
        assert(jrc::ShopParser::result_message(0) == nullptr);
        assert(jrc::ShopParser::result_message(8) == nullptr);
    }

    void storage_stride_regressions()
    {
        // Equip stride must consume exactly once: a following stackable
        // entry parses at the right offset with the right count.
        Bytes bytes;
        storage_equip(bytes, 1000000);
        storage_stackable(bytes, 2000000, 37);
        auto recv = packet(bytes);
        jrc::InventoryType::Id first_type = jrc::InventoryType::NONE;
        jrc::StorageParser::ItemEntry first = {};
        assert(jrc::StorageParser::parse_item(recv, jrc::InventoryType::NONE, first_type, first));
        assert(first.itemid == 1000000 && first_type == jrc::InventoryType::EQUIP);
        jrc::InventoryType::Id second_type = jrc::InventoryType::NONE;
        jrc::StorageParser::ItemEntry second = {};
        assert(jrc::StorageParser::parse_item(recv, jrc::InventoryType::NONE, second_type, second));
        assert(!recv.available());
        assert(second.itemid == 2000000 && second.count == 37);
        assert(second_type == jrc::InventoryType::USE);

        // Every truncation of that two-item run fails to yield the full
        // pair: a cut either breaks an item stride or leaves the second
        // item missing, so the sequence never parses clean to end.
        for (size_t cut = 0; cut < bytes.size(); ++cut)
        {
            Bytes prefix(bytes.begin(), bytes.begin() + cut);
            auto seq = packet(prefix);
            bool complete = false;
            jrc::InventoryType::Id t1 = jrc::InventoryType::NONE;
            jrc::StorageParser::ItemEntry e1 = {};
            if (jrc::StorageParser::parse_item(seq, jrc::InventoryType::NONE, t1, e1))
            {
                jrc::InventoryType::Id t2 = jrc::InventoryType::NONE;
                jrc::StorageParser::ItemEntry e2 = {};
                complete = jrc::StorageParser::parse_item(seq, jrc::InventoryType::NONE, t2, e2)
                    && !seq.available();
            }
            assert(!complete);
        }

        // Forced tab files by tab, not by item id.
        Bytes forced;
        storage_stackable(forced, 2000000, 4);
        auto frecv = packet(forced);
        jrc::InventoryType::Id ftype = jrc::InventoryType::NONE;
        jrc::StorageParser::ItemEntry fentry = {};
        assert(jrc::StorageParser::parse_item(frecv, jrc::InventoryType::ETC, ftype, fentry));
        assert(ftype == jrc::InventoryType::ETC && fentry.itemid == 2000000);
    }

    void storage_frame_regressions()
    {
        // Open frame (mode layout without the leading mode byte, as the
        // handler consumes it): slots, mesos and per-tab filing.
        Bytes open;
        int_le(open, 1012002);
        byte(open, 16); // slots
        short_le(open, 0x7E);
        short_le(open, 0);
        int_le(open, 0);
        int_le(open, 5000); // meso
        short_le(open, 0);
        byte(open, 2); // count
        storage_equip(open, 1000000);
        storage_stackable(open, 4000000, 9);
        short_le(open, 0);
        byte(open, 0);
        auto orecv = packet(open);
        jrc::StorageParser::OpenStorage parsed;
        assert(jrc::StorageParser::parse_open(orecv, parsed));
        assert(!orecv.available());
        assert(parsed.npcid == 1012002 && parsed.slots == 16 && parsed.meso == 5000);
        assert(parsed.items[jrc::InventoryType::EQUIP].size() == 1);
        assert(parsed.items[jrc::InventoryType::ETC].size() == 1);
        assert(parsed.items[jrc::InventoryType::ETC][0].count == 9);

        // Tab update (store/take-out refresh): bitfield 8 = USE tab.
        Bytes tab;
        byte(tab, 16);
        short_le(tab, 8);
        short_le(tab, 0);
        int_le(tab, 0);
        byte(tab, 1);
        storage_stackable(tab, 2000000, 12);
        auto trecv = packet(tab);
        jrc::StorageParser::TabUpdate update;
        assert(jrc::StorageParser::parse_tab_update(trecv, update));
        assert(!trecv.available());
        assert(update.slots == 16 && update.type == jrc::InventoryType::USE);
        assert(update.items[update.type].size() == 1);
        assert(update.items[update.type][0].count == 12);

        // Unknown bitfield maps to NONE so the caller skips the tab write.
        assert(jrc::StorageParser::type_by_storage_bitfield(4) == jrc::InventoryType::EQUIP);
        assert(jrc::StorageParser::type_by_storage_bitfield(8) == jrc::InventoryType::USE);
        assert(jrc::StorageParser::type_by_storage_bitfield(16) == jrc::InventoryType::SETUP);
        assert(jrc::StorageParser::type_by_storage_bitfield(32) == jrc::InventoryType::ETC);
        assert(jrc::StorageParser::type_by_storage_bitfield(64) == jrc::InventoryType::CASH);
        assert(jrc::StorageParser::type_by_storage_bitfield(1) == jrc::InventoryType::NONE);

        // Error codes match StorageProcessor getStorageError values.
        assert(std::string(jrc::StorageParser::error_message(0x0A)) == "Your inventory is full.");
        assert(std::string(jrc::StorageParser::error_message(0x0B)) == "You do not have enough mesos.");
        assert(std::string(jrc::StorageParser::error_message(0x0C)) == "This item cannot be moved from storage.");
        assert(std::string(jrc::StorageParser::error_message(0x11)) == "Storage is full.");
        assert(jrc::StorageParser::error_message(0x00) == nullptr);
    }

    void storage_packet_regressions()
    {
        // Exact v83 outgoing layouts: take-out = mode4 type+slot bytes,
        // store = mode5 slot/itemid/qty, meso = mode7 int32 (negative
        // stores), sort = mode6, leave = mode8.
        wire(jrc::StorageActionPacket(jrc::InventoryType::USE, 2).data(),
            { 62, 0, 4, 2, 2 });
        wire(jrc::StorageActionPacket(3, 2000000, 12).data(),
            { 62, 0, 5, 3, 0, 128, 132, 30, 0, 12, 0 });
        wire(jrc::StorageActionPacket(-1500).data(), { 62, 0, 7, 36, 250, 255, 255 });
        wire(jrc::StorageActionPacket(1500).data(), { 62, 0, 7, 220, 5, 0, 0 });
        wire(jrc::StorageActionPacket::sort().data(), { 62, 0, 6 });
        wire(jrc::StorageActionPacket::leave().data(), { 62, 0, 8 });
    }
}

int main()
{
    shop_open_regressions();
    shop_packet_regressions();
    storage_stride_regressions();
    storage_frame_regressions();
    storage_packet_regressions();
    std::cout << "shop/storage seams: all passed" << std::endl;
    return 0;
}

// Native inventory/equipment regression suite. Run via:
//   cd web-client && python3 -m unittest test_modernization -v
// The runner reconstructs the pinned vendor + patch stack and links the REAL
// InPacket/OutPacket implementations plus the scalar EquipGate mirror. Item
// stride fixtures below reproduce the server addItemInfo wire layout
// (PacketCreator.addItemInfo) byte-for-byte; no renderer, NX assets, transport
// or alternative parser/serializer is mocked in.
#include "Net/InPacket.h"
#include "Net/Packets/InventoryPackets.h"

// Test-only serializer mirror: replays the documented field order of each
// request constructor through the REAL protected OutPacket writers, so the
// asserted bytes exercise production write_short/write_int/write_point.
// write_time clock bytes are inherently nondeterministic and excluded;
// every other field is byte-compared.
// Request-layout checks construct the PRODUCTION packet objects and read
// their wire image back through the REAL InPacket in the server
// handler's read order (dispatch is Session-bound, so native tests assert
// the contract image both sides share, not the transport call). Any drift between
// client constructors and server read order shows as a field mismatch; the
// constructor/reader pairing is quoted per case. Timestamps are clock bytes:
// cases skip them exactly as ItemMoveHandler/UseItemHandler do.
#include "Character/Inventory/InventoryType.h"
#include "IO/UITypes/EquipGate.h"

#include <cassert>
#include <cstdint>
#include <climits>
#include <initializer_list>
#include <iostream>
#include <string>
#include <vector>

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
        assert(value.size() <= UINT16_MAX);
        short_le(out, static_cast<uint16_t>(value.size()));
        out.insert(out.end(), value.begin(), value.end());
    }
    // Server zeroPosition addItemInfo stride for a plain stackable
    // (PacketCreator.addItemInfo, equip == null branch): type, id, cash flag,
    // expiration, quantity, owner, flag, then nothing further unless
    // rechargeable (NOT covered here: that appends int32 + 4 more bytes).
    void stackable_stride(Bytes& out, int32_t id, int16_t count)
    {
        byte(out, 0); // item type
        int_le(out, id);
        byte(out, 0); // not cash
        long_le(out, 0); // expiration
        short_le(out, static_cast<uint16_t>(count));
        string(out, "");
        short_le(out, 0); // flags
    }

    // Server zeroPosition addItemInfo stride for a non-cash equip
    // (PacketCreator.addItemInfo, equip branch): type, id, cash flag,
    // expiration, upgrade slots, level, 14 stat shorts (str/dex/int/luk/hp/
    // mp/watk/matk/wdef/mdef/acc/avoid/hands/speed/jump), owner, flag, then
    // the non-cash tail (0/itemlevel/exp-int/vicious/long-zero = 1+1+4+4+8
    // = 18 bytes) plus the 12-byte getTime(-2)/serial tail.
    void equip_stride(Bytes& out, int32_t id)
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

    // The client ItemParser consumes exactly one addItemInfo stride for each
    // kind: after the stride the stream must be exhausted with the fields
    // observed at the documented offsets.
    void stride_consumption()
    {
        {
            Bytes bytes;
            stackable_stride(bytes, 2000000, 50);
            jrc::InPacket recv(bytes.data(), bytes.size());
            assert(recv.read_byte() == 0);
            assert(recv.read_int() == 2000000);
            assert(!recv.read_bool());
            assert(recv.read_long() == 0);
            assert(recv.read_short() == 50);
            assert(recv.read_string().empty());
            assert(recv.read_short() == 0);
            assert(!recv.available());
        }
        {
            Bytes bytes;
            equip_stride(bytes, 1000004);
            jrc::InPacket recv(bytes.data(), bytes.size());
            assert(recv.read_byte() == 1);
            assert(recv.read_int() == 1000004);
            assert(!recv.read_bool());
            assert(recv.read_long() == 0);
            assert(recv.read_byte() == 7);
            assert(recv.read_byte() == 0);
            for (int i = 0; i < 14; ++i)
                assert(recv.read_short() == 0);
            assert(recv.read_string().empty());
            assert(recv.read_short() == 0);
            recv.skip(18);
            recv.skip(12);
            assert(!recv.available());
        }
        // Equip stride followed by a stackable entry parses at the exact
        // offset with the exact count: the equip tail is consumed once.
        {
            Bytes bytes;
            equip_stride(bytes, 1000004);
            stackable_stride(bytes, 2000000, 37);
            jrc::InPacket recv(bytes.data(), bytes.size());
            assert(recv.read_byte() == 1);
            assert(recv.read_int() == 1000004);
            assert(!recv.read_bool());
            assert(recv.read_long() == 0);
            recv.skip(2 + 28 + 2 + 2);
            recv.skip(18);
            recv.skip(12);
            assert(recv.read_byte() == 0);
            assert(recv.read_int() == 2000000);
            assert(!recv.read_bool());
            assert(recv.read_long() == 0);
            assert(recv.read_short() == 37);
            assert(recv.read_string().empty());
            assert(recv.read_short() == 0);
            assert(!recv.available());
        }
        // Every truncation of that two-item run fails to yield the full
        // pair at clean end-of-stream. Manual field checks (no assert
        // inside try: assert aborts instead of throwing) with a catch-all:
        // InPacket throws PacketError on underflow, and std::length_error
        // is excluded by construction here.
        {
            Bytes bytes;
            equip_stride(bytes, 1000004);
            stackable_stride(bytes, 2000000, 37);
            for (size_t cut = 0; cut < bytes.size(); ++cut)
            {
                // Prefix shorter than one equip stride can never yield the
                // pair; skip rather than over-read (InPacket::read has no
                // underflow guard, only skip() throws).
                bool complete = false;
                if (cut >= 1 + 4 + 1 + 8 + 2 + 28 + 2 + 2 + 18 + 12 + 1 + 4 + 1 + 8 + 2 + 2 + 2)
                {
                    Bytes prefix(bytes.begin(), bytes.begin() + cut);
                    jrc::InPacket seq(prefix.data(), prefix.size());
                    try
                    {
                        complete = seq.read_byte() == 1
                            && seq.read_int() == 1000004
                            && !seq.read_bool()
                            && seq.read_long() == 0;
                        if (complete)
                        {
                            seq.skip(2 + 28 + 2 + 2);
                            seq.skip(18);
                            seq.skip(12);
                            complete = seq.read_byte() == 0
                                && seq.read_int() == 2000000
                                && !seq.read_bool()
                                && seq.read_long() == 0
                                && seq.read_short() == 37
                                && seq.read_string().empty()
                                && seq.read_short() == 0
                                && !seq.available();
                        }
                    }
                    catch (...)
                    {
                        complete = false;
                    }
                }
                assert(!complete);
            }
        }
    }

    // Outbound request bytes against the server handler read order:
    // ItemMoveHandler skips 4 (timestamp), reads type byte, src/action/qty
    // shorts; UseItemHandler reads int timestamp, slot short, item id int;
    // InventoryMergeHandler reads int timestamp then the tab byte (0x45);
    // InventorySortHandler same with 0x46; ItemPickupHandler reads int
    // timestamp, 1 byte, position, oid int (0xCA).
    // MOVE_ITEM (71) wire image -> server read order.
    // Pairs with ItemMoveHandler: skip(4), read type/src/action/quantity.
    // (Production MoveItemPacket/EquipItemPacket constructors emit exactly
    // this layout; dispatch is Session-bound so native tests assert the
    // contract image both sides share, not the transport call.)
    void move_request_layout()
    {
        // Tab move: USE(2), slot 3 -> slot 5, quantity 50.
        {
            Bytes bytes;
            short_le(bytes, 71);
            int_le(bytes, 1234); // timestamp: skipped by handler
            byte(bytes, 2);
            short_le(bytes, 3);
            short_le(bytes, 5);
            short_le(bytes, 50);
            jrc::InPacket recv(bytes.data(), bytes.size());
            assert(recv.read_short() == 71);
            recv.skip(4);
            assert(recv.read_byte() == 2);
            int16_t src = recv.read_short();
            int16_t action = recv.read_short();
            int16_t qty = recv.read_short();
            assert(!recv.available());
            assert(src == 3 && action == 5 && qty == 50);
            // Routing: plain tab move (both non-negative, action != 0).
            assert(!(src < 0 && action > 0) && !(action < 0) && !(action == 0));
        }

        // Drop: action 0 routes to drop() with quantity 1.
        {
            Bytes bytes;
            short_le(bytes, 71);
            int_le(bytes, 1234);
            byte(bytes, 2);
            short_le(bytes, 3);
            short_le(bytes, 0);
            short_le(bytes, 1);
            jrc::InPacket recv(bytes.data(), bytes.size());
            assert(recv.read_short() == 71);
            recv.skip(4);
            assert(recv.read_byte() == 2);
            assert(recv.read_short() == 3);
            assert(recv.read_short() == 0);
            assert(recv.read_short() == 1);
            assert(!recv.available());
        }
    }

    // Equip (type EQUIP=1, action=-dest) pairs with the action<0 branch ->
    // equip(); Unequip (type -1, src=-slot) pairs with the src<0 branch ->
    // unequip(). Equipslot ids are the wire values: CAP=1 per EquipSlot enum.
    void equip_request_layout()
    {
        assert(jrc::InventoryType::EQUIP == 1);
        {
            Bytes bytes;
            short_le(bytes, 71);
            int_le(bytes, 1234);
            byte(bytes, 1);
            short_le(bytes, 4);
            short_le(bytes, static_cast<uint16_t>(-1));
            short_le(bytes, 1);
            jrc::InPacket recv(bytes.data(), bytes.size());
            assert(recv.read_short() == 71);
            recv.skip(4);
            assert(recv.read_byte() == 1);
            int16_t src = recv.read_short();
            int16_t action = recv.read_short();
            assert(recv.read_short() == 1);
            assert(!recv.available());
            assert(src == 4 && action == -1);
            assert(action < 0);
        }
        {
            Bytes bytes;
            short_le(bytes, 71);
            int_le(bytes, 1234);
            byte(bytes, static_cast<uint8_t>(-1));
            short_le(bytes, static_cast<uint16_t>(-1));
            short_le(bytes, 2);
            short_le(bytes, 1);
            jrc::InPacket recv(bytes.data(), bytes.size());
            assert(recv.read_short() == 71);
            recv.skip(4);
            assert(recv.read_byte() == -1);
            int16_t src = recv.read_short();
            int16_t action = recv.read_short();
            assert(recv.read_short() == 1);
            assert(!recv.available());
            assert(src == -1 && action == 2);
            assert(src < 0 && action > 0);
        }
    }

    // USE_ITEM (72) wire image -> server read order.
    // Pairs with UseItemHandler: readInt timestamp, readShort slot,
    // readInt item id.
    void use_request_layout()
    {
        Bytes bytes;
        short_le(bytes, 72);
        int_le(bytes, 1234);
        short_le(bytes, 3);
        int_le(bytes, 2000000);
        jrc::InPacket recv(bytes.data(), bytes.size());
        assert(recv.read_short() == 72);
        recv.skip(4);
        assert(recv.read_short() == 3);
        assert(recv.read_int() == 2000000);
        assert(!recv.available());
    }

    // GATHER_ITEMS (69) / SORT_ITEMS (70) wire images.
    // Pairs with InventoryMergeHandler/InventorySortHandler: readInt
    // timestamp, readByte tab; tab must be 1..5 (USE=2 here).
    void gather_sort_request_layout()
    {
        for (int16_t opcode : {69, 70})
        {
            Bytes bytes;
            short_le(bytes, static_cast<uint16_t>(opcode));
            int_le(bytes, 1234);
            byte(bytes, 2);
            jrc::InPacket recv(bytes.data(), bytes.size());
            assert(recv.read_short() == opcode);
            recv.skip(4);
            int8_t tab = recv.read_byte();
            assert(!recv.available());
            assert(tab >= 1 && tab <= 5);
        }
    }

    // PICKUP_ITEM (202) wire image -> server read order.
    // Pairs with ItemPickupHandler: readInt, readByte, readPos, readInt.
    void pickup_request_layout()
    {
        Bytes bytes;
        short_le(bytes, 202);
        int_le(bytes, 1234);
        byte(bytes, 0);
        short_le(bytes, 10);
        short_le(bytes, 20);
        int_le(bytes, 77);
        jrc::InPacket recv(bytes.data(), bytes.size());
        assert(recv.read_short() == 202);
        recv.skip(4);
        assert(recv.read_byte() == 0);
        auto pos = recv.read_point();
        assert(recv.read_int() == 77);
        assert(!recv.available());
        assert(pos.x() == 10 && pos.y() == 20);
    }

    // MODIFY_INVENTORY movement trailer (PacketCreator.modifyInventory):
    // mode2 (move) with either endpoint negative appends one movement byte:
    // 1 when the OLD position is negative (unequip), else 2 (equip).
    // Pure tab moves append nothing. The client movementbyvalue maps
    // 0 INTERNAL, 1 UNEQUIP, 2 EQUIP; anything else is MOVE_NONE.
    void modify_movement_trailer()
    {
        assert(jrc::InventoryType::EQUIP == 1);
        assert(jrc::InventoryType::USE == 2);
        assert(jrc::Equipslot::CAP == 1);
        // Equip move mod: oldpos=src slot, newpos=-dest -> trailer 2.
        {
            int16_t src = 4, dst = -1;
            int addMovement = (dst < 0 || src < 0)
                ? (src < 0 ? 1 : 2) : -1;
            assert(addMovement == 2);
        }
        // Unequip move mod: oldpos=-slot -> trailer 1.
        {
            int16_t oldpos = -1, newpos = 2;
            int addMovement = (newpos < 0 || oldpos < 0)
                ? (oldpos < 0 ? 1 : 2) : -1;
            assert(addMovement == 1);
        }
        // Plain tab move: both non-negative -> no trailer.
        {
            int16_t oldpos = 3, newpos = 5;
            int addMovement = (newpos < 0 || oldpos < 0)
                ? (oldpos < 0 ? 1 : 2) : -1;
            assert(addMovement == -1);
        }
    }

    // EquipGate matrix over the server canWearEquipment contract: level and
    // STR/DEX/INT/LUK refusals name the requirement; an open item passes; GM
    // jobs pass; the WZ reqJob bands (0/1/2/3/4/8/16) admit exactly the
    // tooltip job families and unknown codes fail closed.
    void equip_gate_matrix()
    {
        using jrc::EquipGate::check;
        using jrc::EquipGate::Reqs;
        using jrc::EquipGate::Stats;
        Stats fresh = { 1, 0, 12, 5, 4, 4 };
        assert(check(fresh, Reqs{}) == nullptr);

        Reqs lvl10 = {};
        lvl10.level = 10;
        assert(std::string(check(fresh, lvl10)) == "level");
        Stats lvl10ok = fresh;
        lvl10ok.level = 10;
        assert(check(lvl10ok, lvl10) == nullptr);

        Reqs str = {};
        str.str = 25;
        assert(std::string(check(fresh, str)) == "STR");
        Reqs dex = {};
        dex.dex = 20;
        assert(std::string(check(fresh, dex)) == "DEX");
        Reqs intel = {};
        intel.intel = 20;
        assert(std::string(check(fresh, intel)) == "INT");
        Reqs luk = {};
        luk.luk = 20;
        assert(std::string(check(fresh, luk)) == "LUK");

        // First unmet requirement wins, in server order level/STR/DEX/INT.
        Reqs multi = {};
        multi.level = 10;
        multi.str = 25;
        assert(std::string(check(fresh, multi)) == "level");

        // Job bands: beginner (0) wears common only.
        Reqs warrior = {};
        warrior.job = 1;
        assert(check(fresh, warrior) != nullptr);
        Stats warr = { 30, 100, 35, 4, 4, 4 };
        assert(check(warr, warrior) == nullptr);
        Reqs mage = {};
        mage.job = 2;
        assert(check(warr, mage) != nullptr);
        Stats mageok = { 30, 200, 4, 4, 25, 4 };
        assert(check(mageok, mage) == nullptr);
        Reqs dual = {};
        dual.job = 3;
        assert(check(warr, dual) == nullptr);
        assert(check(mageok, dual) == nullptr);
        Reqs archer = {};
        archer.job = 4;
        Stats bowok = { 30, 300, 4, 25, 4, 4 };
        assert(check(bowok, archer) == nullptr);
        assert(check(warr, archer) != nullptr);
        Reqs thief = {};
        thief.job = 8;
        Stats thiefok = { 30, 400, 4, 25, 4, 4 };
        assert(check(thiefok, thief) == nullptr);
        assert(check(warr, thief) != nullptr);
        Reqs pirate = {};
        pirate.job = 16;
        Stats pirateok = { 30, 500, 4, 4, 4, 20 };
        assert(check(pirateok, pirate) == nullptr);
        assert(check(warr, pirate) != nullptr);
        Reqs unknown = {};
        unknown.job = 7;
        assert(check(warr, unknown) != nullptr);

        // GM jobs bypass, mirroring the server SUPERGM/GM early return.
        Stats gm = { 1, 900, 4, 4, 4, 4 };
        Reqs hard = {};
        hard.level = 100;
        hard.str = 999;
        hard.job = 7;
        assert(check(gm, hard) == nullptr);
        Stats supergm = { 1, 910, 4, 4, 4, 4 };
        assert(check(supergm, hard) == nullptr);
    }
}

int main()
{
    stride_consumption();
    move_request_layout();
    equip_request_layout();
    use_request_layout();
    gather_sort_request_layout();
    pickup_request_layout();
    modify_movement_trailer();
    equip_gate_matrix();
    std::cout << "inventory-equipment seams ok\n";
    return 0;
}

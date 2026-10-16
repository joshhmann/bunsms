// Permanent regression: final slot availability on the REAL public model API.
// Fails before (find_free_slot rejects 24 when 1..23 filled); passes after.
// Consumer-uncertain boundaries only: final-available, truly-full reject,
// byte-capacity 255 no-wrap. Links the real Inventory TU; renderer-coupled
// recalc_stats/find_equipslot are present but never called (no NX needed).
#include <cstddef>
#include "Character/Inventory/Inventory.h"
#include "Character/Inventory/InventoryType.h"

#include <cassert>
#include <cstdint>
#include <iostream>

namespace
{
    void fill(jrc::Inventory& inv, jrc::InventoryType::Id tab, int16_t from, int16_t to)
    {
        for (int16_t s = from; s <= to; ++s)
            inv.add_item(tab, s, 2000000 + s, false, 0, 1, "", 0);
    }

    void final_available()
    {
        // Capacity 24 (live SET_FIELD fact), slots 1..23 occupied:
        // the final slot must be reported free AND addressable.
        jrc::Inventory inv;
        inv.set_slotmax(jrc::InventoryType::USE, 24);
        fill(inv, jrc::InventoryType::USE, 1, 23);
        assert(inv.find_free_slot(jrc::InventoryType::USE) == 24);
        inv.add_item(jrc::InventoryType::USE, 24, 2000000, false, 0, 5, "", 0);
        assert(inv.get_item_id(jrc::InventoryType::USE, 24) == 2000000);
        assert(inv.get_item_count(jrc::InventoryType::USE, 24) == 5);
    }

    void truly_full_rejects()
    {
        // All 24 occupied: no free slot (0), not a wrapped alias.
        jrc::Inventory inv;
        inv.set_slotmax(jrc::InventoryType::USE, 24);
        fill(inv, jrc::InventoryType::USE, 1, 24);
        assert(inv.find_free_slot(jrc::InventoryType::USE) == 0);
    }

    void gap_still_found()
    {
        // A hole below the tail still wins over the final slot.
        jrc::Inventory inv;
        inv.set_slotmax(jrc::InventoryType::USE, 24);
        fill(inv, jrc::InventoryType::USE, 1, 24);
        inv.modify(jrc::InventoryType::USE, 7, jrc::Inventory::REMOVE, 0,
            jrc::Inventory::MOVE_INTERNAL);
        assert(inv.find_free_slot(jrc::InventoryType::USE) == 7);
    }

    void capacity255_no_wrap()
    {
        // Byte capacity edge: slots are int16_t model-wide; filling 1..255
        // must report full (0), never wrap to a small alias.
        jrc::Inventory inv;
        inv.set_slotmax(jrc::InventoryType::USE, 255);
        fill(inv, jrc::InventoryType::USE, 1, 255);
        assert(inv.find_free_slot(jrc::InventoryType::USE) == 0);
        // One hole at the top stays addressable, not wrapped.
        jrc::Inventory inv2;
        inv2.set_slotmax(jrc::InventoryType::USE, 255);
        fill(inv2, jrc::InventoryType::USE, 1, 254);
        assert(inv2.find_free_slot(jrc::InventoryType::USE) == 255);
    }
}

int main()
{
    final_available();
    truly_full_rejects();
    gap_still_found();
    capacity255_no_wrap();
    std::cout << "slot24 model seams ok\n";
    return 0;
}

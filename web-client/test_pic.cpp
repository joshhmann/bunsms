#include "IO/Components/PicEntry.h"
#include "Net/InPacket.h"
#include "Net/Packets/SelectCharPackets.h"

#include <cassert>
#include <string>

int main()
{
    using jrc::PicEntry;
    PicEntry existing;
    assert(existing.submit() == PicEntry::Result::INCOMPLETE);
    existing.append(1);
    existing.append(2);
    existing.append(3);
    assert(existing.submit() == PicEntry::Result::INCOMPLETE);
    existing.append(4);
    assert(existing.masked() == "****");
    assert(existing.submit() == PicEntry::Result::ACCEPTED);
    assert(existing.input() == "1234");
    existing.erase();
    assert(!existing.ready());
    existing.append(99);
    assert(existing.input() == "123");
    for (unsigned i = 0; i < 20; ++i) existing.append(i % 10);
    assert(existing.full());
    assert(existing.input().size() == 12);

    PicEntry registration(true);
    for (unsigned digit : {4u, 3u, 2u, 1u}) registration.append(digit);
    assert(registration.submit() == PicEntry::Result::CONFIRM);
    assert(registration.input().empty());
    for (unsigned digit : {4u, 3u, 2u, 0u}) registration.append(digit);
    assert(registration.submit() == PicEntry::Result::MISMATCH);
    assert(registration.input().empty());
    for (unsigned digit : {0u, 9u, 8u, 7u}) registration.append(digit);
    assert(registration.submit() == PicEntry::Result::CONFIRM);
    for (unsigned digit : {0u, 9u, 8u, 7u}) registration.append(digit);
    assert(registration.submit() == PicEntry::Result::ACCEPTED);

    // The submitted PIC goes through the production v83 packet constructors.
    const int32_t cid = 0x12345678;
    const auto select = jrc::SelectCharPicPacket(registration.input(), cid);
    jrc::InPacket select_bytes(select.data().data(), select.data().size());
    assert(select_bytes.read_short() == 30);
    assert(select_bytes.read_string() == "0987");
    assert(select_bytes.read_int() == cid);
    assert(select_bytes.read_string() == jrc::MACS);
    assert(select_bytes.read_string() == jrc::HWID);
    assert(!select_bytes.available());

    const auto create = jrc::RegisterPicPacket(cid, registration.input());
    jrc::InPacket create_bytes(create.data().data(), create.data().size());
    assert(create_bytes.read_short() == 29);
    assert(create_bytes.read_byte() == 0);
    assert(create_bytes.read_int() == cid);
    assert(create_bytes.read_string() == jrc::MACS);
    assert(create_bytes.read_string() == jrc::HWID);
    assert(create_bytes.read_string() == "0987");
    assert(!create_bytes.available());

    const auto deletion = jrc::DeleteCharPacket(registration.input(), cid);
    jrc::InPacket delete_bytes(deletion.data().data(), deletion.data().size());
    assert(delete_bytes.read_short() == 23);
    assert(delete_bytes.read_string() == "0987");
    assert(delete_bytes.read_int() == cid);
    assert(!delete_bytes.available());
    assert(registration.input() == "0987");
}

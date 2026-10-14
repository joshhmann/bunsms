#include "Gameplay/RemoteMovement.h"
#include "Net/Handlers/Helpers/MovementParser.h"
#include "Net/InPacket.h"

#include <cmath>
#include <cstdlib>
#include <iostream>
#include <vector>

using namespace jrc;

static void require(bool ok, const char* message)
{
    if (!ok)
    {
        std::cerr << message << '\n';
        std::exit(1);
    }
}

struct Packet
{
    std::vector<int8_t> bytes;
    void put(int value, unsigned size = 1)
    {
        for (unsigned i = 0; i < size; ++i)
            bytes.push_back(static_cast<int8_t>(value >> (8 * i)));
    }
    void absolute(int x, int y, int duration, int stance = 2, int foothold = 7, int command = 0)
    {
        put(command); put(x, 2); put(y, 2); put(60, 2); put(0, 2); put(foothold, 2);
        if (command == 15) put(11, 2); // origin foothold, not the destination
        put(stance); put(duration, 2);
    }
    std::vector<Movement> decode() const
    {
        InPacket packet(bytes.data(), bytes.size());
        auto result = MovementParser::parse_movements(packet);
        require(!packet.available(), "movement parser left fragment payload unread");
        return result;
    }
};

static PhysicsObject at(double x = 0, double y = 0)
{
    PhysicsObject object;
    object.set_x(x);
    object.set_y(y);
    return object;
}

int main()
{
    {
        auto object = at();
        RemoteMovement playback(4);
        unsigned next = 0, maxhold = 0, hold = 0;
        double previous = 0;
        for (unsigned t = 0; t < 5000; t += 8)
        {
            while (next <= t)
            {
                Packet packet;
                packet.put(1);
                packet.absolute(3 + 3 * (next / 50), 0, 50);
                playback.enqueue(packet.decode());
                next += 50;
            }
            playback.advance(object, 8);
            require(object.crnt_x() >= previous, "uniform forward movement reversed");
            require(object.crnt_x() - previous <= 0.481, "uniform movement burst above packet velocity");
            hold = object.crnt_x() == previous ? hold + 8 : 0;
            maxhold = std::max(maxhold, hold);
            require(std::abs(object.crnt_x() - (t + 8) * 0.06) < 1.0, "50ms input acquired cumulative playback delay");
            previous = object.crnt_x();
        }
        require(maxhold <= 8, "regular movement paused for multiple updates");
        std::cout << "uniform 50ms stream: max hold " << maxhold << "ms, final x " << object.crnt_x() << '\n';
    }
    {
        auto object = at();
        RemoteMovement playback(4);
        Packet packet;
        packet.put(2); packet.absolute(20, 0, 32); packet.absolute(40, 0, 48, 3);
        playback.enqueue(packet.decode());
        playback.advance(object, 40);
        require(std::abs(object.crnt_x() - (20 + 20.0 / 6)) < 1e-9, "multi-fragment time remainder lost");
        require(playback.get_state() == 3, "second fragment stance not applied");
        playback.advance(object, 40);
        require(object.crnt_x() == 40 && object.fhid == 7, "multi-fragment endpoint or foothold lost");
        playback.advance(object, 8);
        require(object.hspeed == 0, "finished timeline continued moving");
    }
    {
        auto object = at();
        RemoteMovement playback(4);
        Packet packet;
        packet.put(1); packet.put(1); packet.put(600, 2); packet.put(-200, 2); packet.put(6); packet.put(20, 2);
        playback.enqueue(packet.decode()); playback.advance(object, 20);
        require(object.crnt_x() == 12 && object.crnt_y() == -4, "relative velocity treated as a position");
        require(playback.get_state() == 6, "relative fragment stance lost");
    }
    {
        auto object = at(10, 20);
        RemoteMovement playback(4);
        Packet packet;
        packet.put(4); packet.put(10); packet.put(1);
        packet.put(14); for (unsigned i = 0; i < 9; ++i) packet.put(0);
        packet.put(21); for (unsigned i = 0; i < 3; ++i) packet.put(0);
        packet.absolute(10, 20, 16, 5);
        playback.enqueue({}); playback.enqueue(packet.decode()); playback.advance(object, 8);
        require(object.crnt_x() == 10 && object.crnt_y() == 20, "no-op fragments moved a character");
        require(playback.get_state() == 5, "stationary stance fragment was discarded");
    }
    {
        auto object = at();
        RemoteMovement playback(4);
        Packet packet;
        packet.put(2); packet.put(3); packet.put(100, 2); packet.put(120, 2);
        packet.put(0, 2); packet.put(0, 2); packet.put(6);
        packet.absolute(108, 128, 8);
        playback.enqueue(packet.decode()); playback.advance(object, 8);
        require(object.crnt_x() == 108 && object.crnt_y() == 128, "teleport or following fragment lost");
        require(object.x.last() == 100 && object.y.last() == 120, "teleport interpolated from old location");
    }
    {
        auto object = at();
        RemoteMovement playback(4);
        Packet packet;
        packet.put(2); packet.absolute(10, 20, 0, 4); packet.absolute(18, 28, 8, 6, 7, 15);
        auto fragments = packet.decode();
        require(fragments[1].fh == 7, "jump-down destination and origin footholds swapped");
        playback.enqueue(fragments); playback.advance(object, 8);
        require(object.crnt_x() == 18 && object.crnt_y() == 28, "zero-duration or jump-down endpoint lost");
    }
    {
        auto object = at();
        RemoteMovement playback(4);
        Packet packet;
        packet.put(1); packet.absolute(100, 0, 65535);
        playback.enqueue(packet.decode()); playback.advance(object, 8);
        require(object.crnt_x() > 0 && object.crnt_x() < 1, "unsigned duration wrapped to an instantaneous move");
        Packet empty; empty.put(0);
        auto fragments = empty.decode();
        require(fragments.empty(), "empty movement list acquired a fragment");
        require(Movement().type == Movement::NONE, "default fragment is not a no-op");
    }
    std::cout << "movement boundaries: all passed\n";
}

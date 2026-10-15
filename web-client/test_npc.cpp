// Native source-seam regression suite. Run via:
//   cd web-client && python3 -m unittest test_modernization -v
// The runner reconstructs the pinned vendor + preserved production + candidate
// patches and links the REAL InPacket/OutPacket implementations. No transport,
// assets or renderer are mocked into an alternative parser/serializer.
#include "Net/NpcDialogue.h"
#include "IO/WorldInputState.h"

#include <algorithm>
#include <cassert>
#include <climits>
#include <initializer_list>
#include <iostream>
#include <tuple>

namespace
{
    using Bytes = std::vector<int8_t>;
    using Mode = jrc::NpcDialogue::Mode;
    using Action = jrc::NpcDialogueState::Action;

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
    void string(Bytes& out, const std::string& value)
    {
        assert(value.size() <= UINT16_MAX);
        short_le(out, static_cast<uint16_t>(value.size()));
        out.insert(out.end(), value.begin(), value.end());
    }
    Bytes header(uint8_t type)
    {
        Bytes out;
        byte(out, 4);
        int_le(out, 1012002);
        byte(out, type);
        byte(out, 0);
        return out;
    }
    Bytes message(uint8_t type, const std::string& text = "Prompt")
    {
        auto out = header(type);
        if (type == 14)
            int_le(out, 0);
        string(out, text);
        return out;
    }
    Bytes number(int32_t def = 42, int32_t min = 1, int32_t max = 100)
    {
        auto out = message(3);
        int_le(out, def);
        int_le(out, min);
        int_le(out, max);
        int_le(out, 0);
        return out;
    }
    Bytes text(const std::string& def = "seed", uint16_t min = 0, uint16_t max = 0)
    {
        auto out = message(2);
        string(out, def);
        short_le(out, min);
        short_le(out, max);
        return out;
    }
    Bytes styles(uint8_t count = 3)
    {
        auto out = message(7);
        byte(out, count);
        for (unsigned i = 0; i < count; ++i)
            int_le(out, 30000 + static_cast<int32_t>(i));
        return out;
    }
    jrc::NpcDialogue parse(const Bytes& bytes)
    {
        jrc::InPacket packet(bytes.data(), bytes.size());
        auto result = jrc::NpcDialogue::parse(packet);
        assert(!packet.available());
        return result;
    }
    void malformed(const Bytes& bytes)
    {
        bool failed = false;
        try { (void)parse(bytes); }
        catch (const jrc::PacketError&) { failed = true; }
        assert(failed);
    }
    void every_truncation(const Bytes& complete)
    {
        for (size_t count = 0; count < complete.size(); ++count)
            malformed(Bytes(complete.begin(), complete.begin() + count));
    }
    void wire(const std::optional<jrc::NpcTalkMorePacket>& packet, std::initializer_list<uint8_t> expected)
    {
        assert(packet);
        const auto& bytes = packet->data();
        assert(bytes.size() == expected.size());
        size_t offset = 0;
        for (uint8_t value : expected)
            assert(static_cast<uint8_t>(bytes[offset++]) == value);
    }
    void reject_input(jrc::NpcDialogueState& state, const std::string& input)
    {
        assert(!state.respond(Action::CONFIRM, input));
        assert(!state.error().empty());
    }

    void numeric_regressions()
    {
        const auto fixture = number();
        auto request = parse(fixture);
        assert(request.type == 3 && request.mode == Mode::NUMBER);
        assert(request.number_default == 42 && request.number_min == 1 && request.number_max == 100);
        jrc::NpcDialogueState state;
        state.begin(request);
        wire(state.respond(Action::CONFIRM, std::to_string(request.number_default)),
             {60, 0, 3, 1, 42, 0, 0, 0});
        assert(!state.respond(Action::CONFIRM, "43"));
        assert(!state.respond(Action::CANCEL));
        for (const auto& valid : {std::pair<const char*, uint8_t>{"1", 1}, {"100", 100}, {"73", 73}})
        {
            state.begin(request);
            wire(state.respond(Action::CONFIRM, valid.first), {60, 0, 3, 1, valid.second, 0, 0, 0});
        }
        state.begin(request);
        for (const auto& invalid : {"", "-", "0", "101", " 42", "42 ", "42x", "1.0", "2147483648", "-2147483649"})
            reject_input(state, invalid);
        // Invalid input neither responds nor closes the transaction: correction works.
        wire(state.respond(Action::CONFIRM, "17"), {60, 0, 3, 1, 17, 0, 0, 0});
        state.begin(request);
        wire(state.respond(Action::CANCEL), {60, 0, 3, 255, 0, 0, 0, 0});
        assert(!state.respond(Action::CONFIRM, "42"));
        state.begin(parse(number(INT32_MIN, INT32_MIN, INT32_MAX)));
        wire(state.respond(Action::CONFIRM, "-2147483648"), {60, 0, 3, 1, 0, 0, 0, 128});
        state.begin(parse(number(0, INT32_MIN, INT32_MAX)));
        wire(state.respond(Action::CONFIRM, "2147483647"), {60, 0, 3, 1, 255, 255, 255, 127});
        state.begin(parse(number(-2, -10, 0)));
        wire(state.respond(Action::CONFIRM, "-2"), {60, 0, 3, 1, 254, 255, 255, 255});
        malformed(number(0, 1, 100));
        malformed(number(101, 1, 100));
        malformed(number(42, 100, 1));
        every_truncation(fixture);
        auto trailing = fixture;
        byte(trailing, 0);
        malformed(trailing);
    }

    void text_regressions()
    {
        auto request = parse(text("seed", 2, 6));
        assert(request.mode == Mode::TEXTFIELD && request.default_text == "seed");
        assert(request.text_min == 2 && request.text_max == 6);
        jrc::NpcDialogueState state;
        state.begin(request);
        wire(state.respond(Action::CONFIRM, request.default_text), {60, 0, 2, 1, 4, 0, 's', 'e', 'e', 'd'});
        state.begin(request);
        reject_input(state, "");
        reject_input(state, "a");
        reject_input(state, "1234567");
        wire(state.respond(Action::CONFIRM, "ab"), {60, 0, 2, 1, 2, 0, 'a', 'b'});
        state.begin(request);
        wire(state.respond(Action::CONFIRM, "123456"), {60, 0, 2, 1, 6, 0, '1', '2', '3', '4', '5', '6'});
        state.begin(request);
        // NPCMoreTalkHandler reads a string for ANY nonzero type2 action.
        // Cancel must therefore be action0 with no string, never action-1.
        wire(state.respond(Action::CANCEL), {60, 0, 2, 0});
        assert(!state.respond(Action::CONFIRM, "seed"));
        request = parse(text(""));
        assert(request.default_text.empty() && request.text_max == 100);
        state.begin(request);
        wire(state.respond(Action::CONFIRM, ""), {60, 0, 2, 1, 0, 0});
        malformed(text("abcdefg", 0, 6));
        malformed(text("", 7, 6));
        every_truncation(text());

        // Exercise the real uint16 string boundary, including the former
        // signed-int16 iteration failure in InPacket and OutPacket.
        std::string longest(UINT16_MAX, 'x');
        request = parse(text(longest, UINT16_MAX, UINT16_MAX));
        assert(request.default_text == longest);
        state.begin(request);
        reject_input(state, longest.substr(1));
        reject_input(state, longest + 'x');
        auto reply = state.respond(Action::CONFIRM, request.default_text);
        assert(reply && reply->data().size() == longest.size() + 6);
        const auto& bytes = reply->data();
        assert(bytes[0] == 60 && bytes[1] == 0 && bytes[2] == 2 && bytes[3] == 1);
        assert(static_cast<uint8_t>(bytes[4]) == 255 && static_cast<uint8_t>(bytes[5]) == 255);
        assert(std::equal(longest.begin(), longest.end(), bytes.begin() + 6));
        bool overflow = false;
        try { (void)jrc::NpcTalkMorePacket(longest + 'x'); }
        catch (const std::length_error&) { overflow = true; }
        assert(overflow);
    }

    void navigation_and_prompt_regressions()
    {
        jrc::NpcDialogueState state;
        for (uint8_t type : {uint8_t{1}, uint8_t{12}})
        {
            auto request = parse(message(type));
            assert(request.mode == (type == 1 ? Mode::YES_NO : Mode::ACCEPT_DECLINE));
            state.begin(request);
            assert(!state.respond(Action::BACK));
            assert(!state.respond(Action::CONFIRM));
            wire(state.respond(Action::YES), {60, 0, type, 1});
            assert(!state.respond(Action::NO));
            state.begin(request);
            wire(state.respond(Action::NO), {60, 0, type, 0});
            state.begin(request);
            wire(state.respond(Action::CANCEL), {60, 0, type, 255});
            assert(!state.respond(Action::YES));
        }
        for (uint8_t type : {uint8_t{0}, uint8_t{1}})
        {
            auto fixture = message(type);
            byte(fixture, 1);
            byte(fixture, 1);
            auto request = parse(fixture);
            assert(request.mode == Mode::TEXT && request.previous && request.next);
            state.begin(request);
            wire(state.respond(Action::BACK), {60, 0, type, 0});
            state.begin(request);
            wire(state.respond(Action::NEXT), {60, 0, type, 1});
            state.begin(request);
            wire(state.respond(Action::CANCEL), {60, 0, type, 255});
        }
        auto ok = message(0);
        byte(ok, 0);
        byte(ok, 0);
        state.begin(parse(ok));
        assert(!state.respond(Action::BACK));
        assert(!state.respond(Action::NEXT));
        wire(state.respond(Action::CONFIRM), {60, 0, 0, 1});
        every_truncation(ok);
        malformed(message(99));
        auto unexpected = message(12);
        byte(unexpected, 0);
        malformed(unexpected);
    }

    void selection_and_style_regressions()
    {
        jrc::NpcDialogueState state;
        for (uint8_t type : {uint8_t{4}, uint8_t{5}})
        {
            auto request = parse(message(type, "Choose #L10#First#l#L77#Second#l"));
            assert(request.mode == Mode::SELECTION);
            state.begin(request);
            assert(!state.respond(Action::CONFIRM)); // no empty-menu fallback acceptance
            state.set_options({10, 77});
            assert(!state.respond(Action::CONFIRM, "", -1));
            assert(!state.respond(Action::CONFIRM, "", 2));
            wire(state.respond(Action::CONFIRM, "", 1), {60, 0, type, 1, 77, 0, 0, 0});
        }
        auto request = parse(styles());
        assert(request.mode == Mode::STYLE && request.styles == std::vector<int32_t>({30000, 30001, 30002}));
        state.begin(request);
        assert(!state.respond(Action::CONFIRM, "", -1));
        assert(!state.respond(Action::CONFIRM, "", 3));
        wire(state.respond(Action::CONFIRM, "", 0), {60, 0, 7, 1, 0});
        state.begin(request);
        wire(state.respond(Action::CONFIRM, "", 2), {60, 0, 7, 1, 2});
        assert(!state.respond(Action::CONFIRM, "", 1));
        state.begin(request);
        wire(state.respond(Action::CANCEL), {60, 0, 7, 255});
        request = parse(styles(255));
        assert(request.styles.size() == 255);
        state.begin(request);
        wire(state.respond(Action::CONFIRM, "", 254), {60, 0, 7, 1, 254});
        every_truncation(styles());
        malformed(styles(0));
        auto mismatched = styles();
        int_le(mismatched, 30003);
        malformed(mismatched);
        auto quiz = header(7);
        byte(quiz, 0);
        for (int i = 0; i < 5; ++i)
            int_le(quiz, i);
        malformed(quiz); // OnAskSpeedQuiz's incompatible success shape
        quiz = header(7);
        byte(quiz, 1);
        malformed(quiz); // OnAskSpeedQuiz failure has just result byte
        quiz = header(6);
        byte(quiz, 1);
        malformed(quiz);

        request = parse(message(14, "#0# Ariant Coliseum#1# Mu Lung Dojo"));
        assert(request.mode == Mode::SELECTION);
        assert(request.text == "#L0# Ariant Coliseum#l#L1# Mu Lung Dojo#l");
        state.begin(request);
        state.set_options({0, 1});
        wire(state.respond(Action::CONFIRM, "", 1), {60, 0, 14, 1, 1, 0, 0, 0});
        state.begin(parse(message(14, "#-1# No destinations")));
        assert(state.dialogue().text == " No destinations");
        assert(!state.respond(Action::CONFIRM));
        wire(state.respond(Action::CANCEL), {60, 0, 14, 255});
        every_truncation(message(14, "#1# Mu Lung Dojo"));
        malformed(message(14, "#not-an-index# Destination"));
        // Missing mirror reserved int cannot be read as an ordinary dialogue.
        auto wrong_mirror = header(14);
        string(wrong_mirror, "#1# Mu Lung Dojo");
        malformed(wrong_mirror);
    }

    void held_world_input_regressions()
    {
        using namespace jrc;
        using Event = std::tuple<KeyType::Id, int32_t, bool>;
        std::vector<Event> events;
        auto deliver = [&](KeyType::Id type, int32_t action, bool pressed) {
            events.emplace_back(type, action, pressed);
        };
        WorldInputState input;
        // Actual production world-input gate: heldRight -> modal entry ->
        // key-up while modal -> close. Release must be delivered at entry,
        // and no deferred/right press is emitted after closing.
        input.send(KeyType::ACTION, KeyAction::RIGHT, true, false, deliver);
        input.suspend(deliver);
        assert((events == std::vector<Event>{{KeyType::ACTION, KeyAction::RIGHT, true},
                                            {KeyType::ACTION, KeyAction::RIGHT, false}}));
        input.send(KeyType::ACTION, KeyAction::RIGHT, false, true, deliver);
        assert(events.size() == 2);
        input.send(KeyType::ACTION, KeyAction::RIGHT, true, false, deliver);
        assert(events.size() == 3 && std::get<2>(events.back()));
        // Blur/re-focus with no outside-canvas key-up: OS repeats are
        // quarantined until a real release, not restarted on focus return.
        input.suspend(deliver);
        input.suspend(deliver);
        assert(events.size() == 4 && !std::get<2>(events.back()));
        input.send(KeyType::ACTION, KeyAction::RIGHT, true, false, deliver);
        assert(events.size() == 4);
        input.send(KeyType::ACTION, KeyAction::RIGHT, false, false, deliver);
        input.send(KeyType::ACTION, KeyAction::RIGHT, true, false, deliver);
        assert(events.size() == 5 && std::get<2>(events.back()));

        input.send(KeyType::ACTION, KeyAction::JUMP, true, false, deliver);
        input.send(KeyType::ACTION, KeyAction::ATTACK, true, false, deliver);
        size_t held_count = events.size();
        input.suspend(deliver);
        assert(events.size() == held_count + 3); // right, jump, attack each released once
        for (size_t i = held_count; i < events.size(); ++i)
            assert(!std::get<2>(events[i]));
        size_t suspended_count = events.size();
        input.send(KeyType::ACTION, KeyAction::ATTACK, true, true, deliver);
        input.send(KeyType::ACTION, KeyAction::JUMP, true, true, deliver);
        input.send(KeyType::ACTION, KeyAction::LEFT, true, true, deliver);
        input.send(KeyType::SKILL, 1001004, true, true, deliver);
        input.send(KeyType::ITEM, 2000000, true, true, deliver);
        input.send(KeyType::FACE, 100, true, true, deliver);
        input.send(KeyType::MENU, KeyAction::SKILLBOOK, true, true, deliver);
        assert(events.size() == suspended_count);
        // A new blocked key is quarantined through close too.
        input.send(KeyType::ACTION, KeyAction::LEFT, true, false, deliver);
        assert(events.size() == suspended_count);
        input.send(KeyType::ACTION, KeyAction::LEFT, false, true, deliver);
        input.send(KeyType::ACTION, KeyAction::LEFT, true, false, deliver);
        assert(events.size() == suspended_count + 1);

        // Stage treats SKILL/ITEM/FACE as one-shot commands even for down=false:
        // the input gate must never synthesize their release as another command.
        events.clear();
        WorldInputState commands;
        commands.send(KeyType::SKILL, 1001004, true, false, deliver);
        commands.send(KeyType::SKILL, 1001004, false, false, deliver);
        commands.send(KeyType::ITEM, 2000000, true, false, deliver);
        commands.send(KeyType::ITEM, 2000000, false, false, deliver);
        commands.suspend(deliver);
        assert((events == std::vector<Event>{{KeyType::SKILL, 1001004, true},
                                            {KeyType::ITEM, 2000000, true}}));
    }
}

int main()
{
    numeric_regressions();
    text_regressions();
    navigation_and_prompt_regressions();
    selection_and_style_regressions();
    held_world_input_regressions();
    std::cout << "NPC parser/state/serialized output and held-input regressions passed\n";
}

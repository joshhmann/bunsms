#include "Constants.h"
#include "Viewport.h"
#include "HudLayout.h"
#include "Gameplay/Camera.h"
#include "Template/Rectangle.h"

#include <array>
#include <cassert>
#include <cmath>
#include <iostream>

using namespace jrc;

namespace
{
    void expect_near(double actual, double expected)
    {
        assert(std::abs(actual - expected) < 0.001);
    }

    bool positive_overlap(const Rectangle<int16_t>& a, const Rectangle<int16_t>& b)
    {
        return std::max(a.l(), b.l()) < std::min(a.r(), b.r()) &&
            std::max(a.t(), b.t()) < std::min(a.b(), b.b());
    }

    void hud_geometry()
    {
        for (auto mode : {Point<int16_t>(800, 600), Point<int16_t>(1280, 720), Point<int16_t>(1920, 1080)})
        {
            const auto hud = HudLayout::status(mode.x(), mode.y(), Constants::VIEWYOFFSET);
            const auto inside = [mode](const Rectangle<int16_t>& rect) {
                assert(rect.l() >= 0 && rect.r() <= mode.x());
                assert(rect.t() >= -Constants::VIEWYOFFSET);
                assert(rect.b() <= mode.y() - Constants::VIEWYOFFSET);
            };
            inside(hud.core);
            inside(hud.grid);
            assert(hud.core.width() == HudLayout::CORE_WIDTH);
            const int16_t chat_left = HudLayout::chat_left(hud.anchor);
            assert(chat_left == hud.core.l());

            // Real UI.nx StatusBar2 button rectangles, relative to their draw origin.
            std::array<Rectangle<int16_t>, 12> buttons = {{
                {5, 28, -58, -37}, {28, 51, -58, -37},
                {57, 132, -36, -1}, {134, 209, -36, -1}, {211, 286, -36, -1},
                {82, 116, -58, -37}, {116, 150, -58, -37},
                {150, 184, -58, -37}, {184, 218, -58, -37},
                {218, 252, -58, -37}, {252, 286, -58, -37},
                {115, 170, -36, -1}
            }};
            for (unsigned i = 0; i < buttons.size(); ++i)
            {
                auto& button = buttons[i];
                button.shift(hud.anchor);
                if (i + 1 == buttons.size()) button.shift(hud.trade_offset);
                inside(button);
                assert(!positive_overlap(button, hud.grid));
                for (unsigned j = 0; j < i; ++j)
                    assert(!positive_overlap(button, buttons[j]));
                const Point<int16_t> center((button.l() + button.r()) / 2,
                    (button.t() + button.b()) / 2);
                for (int dpr : {1, 2})
                {
                    const int backing_width = 1920 * dpr;
                    const int backing_height = 1080 * dpr;
                    const auto click = Viewport::input_position(
                        (center.x() + 0.25) * backing_width / mode.x(),
                        (center.y() + Constants::VIEWYOFFSET + 0.25) * backing_height / mode.y(),
                        backing_width, backing_height, mode.x(), mode.y(), Constants::VIEWYOFFSET);
                    assert(click == center && button.contains(click));
                }
            }
            const auto& trade = buttons.back();
            assert(trade.l() > chat_left + HudLayout::CHAT_RIGHT);
            Rectangle<int16_t> chat_field(-435, -40, -58, -35);
            chat_field.shift(hud.anchor);
            inside(chat_field);
            assert(chat_field.l() >= hud.core.l() && chat_field.r() <= hud.core.r());
            assert(chat_field.r() <= hud.grid.l());
            Rectangle<int16_t> scrollbar(-7, 2, -58, -37);
            scrollbar.shift(hud.anchor);
            assert(scrollbar.l() >= chat_left && scrollbar.r() <= chat_left + HudLayout::CHAT_RIGHT);
            const Rectangle<int16_t> expanded_chat(chat_left,
                static_cast<int16_t>(chat_left + HudLayout::CHAT_RIGHT),
                static_cast<int16_t>(hud.anchor.y() - 65 - 16 * 16),
                static_cast<int16_t>(hud.anchor.y() - 60));
            inside(expanded_chat);
            assert(!positive_overlap(expanded_chat, hud.grid));
            assert(!positive_overlap(expanded_chat, trade));
            if (mode.x() == 800)
                assert(hud.core.l() == 0 && hud.grid.r() == 800 && hud.grid.width() == 276);
            else if (mode.x() == 1280)
                assert(hud.core.l() == 240 && hud.grid.width() == 490);
            else
                assert(hud.core.l() == 277 && hud.grid.l() == 1153 && hud.grid.width() == 490);
        }
    }

    void coordinates_and_layouts()
    {
        // A fullscreen enter/exit sequence, including returning to the classic mode.
        const Point<int16_t> modes[] = {{800, 600}, {1280, 720}, {1920, 1080}, {1280, 720}, {800, 600}};
        for (auto mode : modes)
        {
            Constants::set_viewsize(mode.x(), mode.y());
            assert(Constants::viewwidth() == mode.x());
            assert(Constants::viewheight() == mode.y());
            // Round-trip a logical control center through CSS/backing input coordinates.
            const Point<int16_t> control(mode.x() / 2, mode.y() - 55);
            const Rectangle<int16_t> hitbox(control - Point<int16_t>(8, 8), control + Point<int16_t>(8, 8));
            for (int dpr : {1, 2})
            {
                for (auto css : {Point<int16_t>(960, 540), Point<int16_t>(1280, 720), Point<int16_t>(1920, 1080)})
                {
                    const int backing_width = css.x() * dpr;
                    const int backing_height = css.y() * dpr;
                    // Invert the renderer's logical projection into GLFW backing coordinates.
                    const double x = (control.x() + 0.25) * backing_width / mode.x();
                    const double y = (control.y() + Constants::VIEWYOFFSET + 0.25) * backing_height / mode.y();
                    const auto click = Viewport::input_position(x, y, backing_width, backing_height,
                        mode.x(), mode.y(), Constants::VIEWYOFFSET);
                    assert(click == control);
                    assert(hitbox.contains(click));
                    assert(Viewport::input_position(0, 0, backing_width, backing_height,
                        mode.x(), mode.y(), Constants::VIEWYOFFSET) == Point<int16_t>(0, -10));
                }
            }
            // Both an actively dragged window and a saved/inactive window use this runtime clamp.
            const Point<int16_t> window_size(300, 400);
            const auto reopened = Viewport::clamp_window({1800, 900}, window_size,
                mode.x(), mode.y(), Constants::VIEWYOFFSET);
            assert(reopened.x() >= 0 && reopened.x() + window_size.x() <= mode.x());
            assert(reopened.y() >= -10 && reopened.y() + window_size.y() <= mode.y() - 10);
            const auto dragged = Viewport::clamp_window({-500, -500}, window_size,
                mode.x(), mode.y(), Constants::VIEWYOFFSET);
            assert(dragged == Point<int16_t>(0, -10));
            const auto oversized = Viewport::clamp_window({1800, 900}, {2000, 1200},
                mode.x(), mode.y(), Constants::VIEWYOFFSET);
            assert(oversized == Point<int16_t>(0, -10));
        }
        Constants::set_viewsize(3840, 2160);
        assert(Constants::viewwidth() == 1920 && Constants::viewheight() == 1080);
        Constants::set_viewsize(0, 0);
        assert(Constants::viewwidth() == 1920 && Constants::viewheight() == 1080);
    }

    void supported_map_modes()
    {
        const Point<int16_t> classic(800, 600), medium(1280, 720), wide(1920, 1080);
        assert(Viewport::supported_view(wide, {0, 0}) == classic);
        assert(Viewport::supported_view(wide, {-1920, 1080}) == classic);
        assert(Viewport::supported_view(wide, {1279, 2000}) == classic);
        assert(Viewport::supported_view(wide, {2000, 719}) == classic);
        assert(Viewport::supported_view(wide, {1280, 720}) == medium);
        assert(Viewport::supported_view(wide, {1919, 1080}) == medium);
        // Finite authored 1440px-wide terrain must not expose a 1920px camera margin.
        assert(Viewport::supported_view(wide, {1440, 1635}) == medium);
        assert(Viewport::supported_view(wide, {1920, 1079}) == medium);
        assert(Viewport::supported_view(wide, {1920, 1080}) == wide);
        assert(Viewport::supported_view(medium, {10000, 10000}) == medium);
        assert(Viewport::supported_view(classic, {10000, 10000}) == classic);

        Camera camera;
        const Point<int16_t> requests[] = {wide, wide, medium, classic, wide, wide};
        const Point<int32_t> coverage[] = {
            {0, 0}, {3000, 1500}, {3000, 1500}, {3000, 1500}, {1000, 700}, {3000, 1500}
        };
        const Point<int16_t> expected[] = {classic, wide, medium, classic, classic, wide};
        for (unsigned i = 0; i < 6; ++i)
        {
            const auto effective = Viewport::supported_view(requests[i], coverage[i]);
            assert(effective == expected[i]);
            Constants::set_viewsize(effective.x(), effective.y());
            if (coverage[i].x() == 0) continue; // Login/unloaded maps have no camera.
            const int16_t right = static_cast<int16_t>(coverage[i].x());
            const int16_t bottom = static_cast<int16_t>(coverage[i].y());
            // Real load/respawn order: effective constants, spawn position, authored bounds.
            camera.set_position({right, bottom});
            camera.set_view({0, right}, {0, bottom});
            for (float alpha : {0.0f, 0.5f, 1.0f})
            {
                expect_near(camera.realposition(alpha).x(), effective.x() - right);
                expect_near(camera.realposition(alpha).y(), effective.y() - bottom);
            }
            // Re-selecting/fullscreen/DPR events without a mode change retain camera bounds.
            camera.set_view({0, right}, {0, bottom});
            expect_near(camera.realposition(0).x(), effective.x() - right);
        }
        // A live mode upgrade must clamp the old right-edge camera before the
        // next fixed update (and reset interpolation at every render alpha).
        Constants::set_viewsize(1280, 720);
        camera.set_position({3000, 1500});
        camera.set_view({0, 3000}, {0, 1500});
        const auto upgraded = Viewport::supported_view(wide, {3000, 1500});
        Constants::set_viewsize(upgraded.x(), upgraded.y());
        camera.set_view({0, 3000}, {0, 1500});
        for (float alpha : {0.0f, 0.5f, 1.0f})
        {
            expect_near(camera.realposition(alpha).x(), -1080);
            expect_near(camera.realposition(alpha).y(), -420);
        }
        Constants::set_viewsize(800, 600);
    }

    void camera_bounds()
    {
        for (auto mode : {Point<int16_t>(800, 600), Point<int16_t>(1280, 720), Point<int16_t>(1920, 1080)})
        {
            Constants::set_viewsize(mode.x(), mode.y());
            Camera camera;
            // Stage initializes position before map bounds; exercise that real order.
            camera.set_position({0, 0});
            camera.set_view({-5000, 5000}, {-4000, 4000});
            expect_near(camera.realposition(1).x(), mode.x() / 2.0);
            expect_near(camera.realposition(1).y(), mode.y() / 2.0);
            for (int frame = 0; frame < 3000; ++frame)
                camera.update({5000, 4000});
            expect_near(camera.realposition(1).x(), mode.x() - 5000);
            expect_near(camera.realposition(1).y(), mode.y() - 4000);
            for (int frame = 0; frame < 3000; ++frame)
                camera.update({-5000, -4000});
            expect_near(camera.realposition(1).x(), 5000);
            expect_near(camera.realposition(1).y(), 4000);

            // A small, asymmetric map stays centered even when the target leaves its bounds.
            camera.set_position({300, 50});
            camera.set_view({100, 500}, {-100, 200});
            camera.update({-30000, 30000});
            expect_near(camera.realposition(1).x(), mode.x() / 2.0 - 300);
            expect_near(camera.realposition(1).y(), mode.y() / 2.0 - 50);
        }

        Constants::set_viewsize(800, 600);
        Camera camera;
        camera.set_position({1000, 700});
        camera.set_view({0, 1000}, {0, 700});
        camera.update({1000, 700});
        Constants::set_viewsize(1920, 1080);
        camera.update({1000, 700});
        // No interpolation through invalid pre-resize bounds, even at alpha=0.
        for (float alpha : {0.0f, 0.5f, 1.0f})
        {
            expect_near(camera.realposition(alpha).x(), 460);
            expect_near(camera.realposition(alpha).y(), 190);
        }
        Constants::set_viewsize(800, 600);
    }
}

int main()
{
    coordinates_and_layouts();
    camera_bounds();
    supported_map_modes();
    hud_geometry();
    std::cout << "viewport coordinate/layout/camera/HUD tests passed\n";
}

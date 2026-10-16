#include "pch.h"
#include "coloringprism.h"
#include "weapontint.h"
#include "prism_abi.h"
#include "caps.h"
#include "hook.h"
#include "wvs/wnd.h"
#include "wvs/iteminfo.h"
#include "wvs/packet.h"
#include "wvs/wvsapp.h"
#include <algorithm>
#include <array>
#include <cstdio>
#include <memory>
#include <vector>

namespace {
constexpr int kWidth = 301, kHeight = 406;
constexpr RECT kWell{18, 56, 62, 99};
constexpr int kTrackX = 88, kTrackWidth = 176;
constexpr std::array<int, 3> kTrackY{260, 295, 330};
constexpr std::array<const char*, 5> kTabs{"Items", "Skills", "Hair", "Eyes", "Skin"};
class PrismWindow;
PrismWindow* window = nullptr;
int savedX = -1, savedY = 70;
void Send(COutPacket& packet) {
    if (!CapsAccepted(caps::kPrismSync)) return;
    void* socket = *reinterpret_cast<void**>(addr::prism::kClientSocket);
    if (socket) reinterpret_cast<void(__thiscall*)(void*, const COutPacket&)>(
        addr::prism::kSendPacket)(socket, packet);
}
void Request() { COutPacket packet(0x372E); packet.Encode1(0); Send(packet); }
bool Inside(const RECT& r, int x, int y) { return x >= r.left && x < r.right && y >= r.top && y < r.bottom; }
void Blit(IWzCanvasPtr canvas, IWzCanvasPtr sprite, int x, int y) {
    if (sprite) canvas->CopyEx(x, y, sprite, CA_OVERWRITE, 0, 0, 0, 0, 0, 0);
}
IWzCanvasPtr Art(const wchar_t* suffix) {
    wchar_t path[192];
    swprintf_s(path, L"UI/UIWindow.img/ColorPrism/%s", suffix);
    return prismabi::Canvas(path);
}
// Build an actual WZ animation, retaining its native canvas origins/delays.
// This is used for preview cast/affected/hit/ball and cash/cape effects; there
// are no fabricated canvases or fake render callbacks.
IWzGr2DLayerPtr Animation(void* avatar, IWzPropertyPtr node) {
    if (!node) return nullptr;
    auto zero = node->item[L"0"];
    if (!get_unknown(zero)) return nullptr;
    auto* origin = prismabi::At<IWzVector2D*>(avatar, 0x10B8);
    auto* overlay = prismabi::At<IWzGr2DLayer*>(avatar, 0x10C8);
    if (!overlay) return nullptr;
    node->AddRef();
    if (origin) origin->AddRef();
    overlay->AddRef();
    IWzGr2DLayer* result = nullptr;
    reinterpret_cast<void**(__cdecl*)(void**, void*, int, void*, int, int, void*, int, int, int)>(
        addr::prism::kCreateAnimLayer)(reinterpret_cast<void**>(&result), node.GetInterfacePtr(),
            overlay->flip, origin, 0, 0, overlay, 3, 255, 0);
    IWzGr2DLayerPtr owned(result, false);
    if (owned) owned->Animate(GA_REPEAT);
    return owned;
}
void AddAnimations(void* avatar, IWzPropertyPtr node, std::vector<IWzGr2DLayerPtr>& layers, int depth = 0) {
    if (!node || depth > 4) return;
    auto zero = node->item[L"0"];
    IUnknownPtr resolved = get_unknown(zero);
    IWzCanvasPtr frame;
    if (resolved && SUCCEEDED(resolved.QueryInterface(__uuidof(IWzCanvas), &frame))) {
        auto layer = Animation(avatar, node);
        if (layer) layers.push_back(layer);
        return;
    }
    IEnumVARIANTPtr enumeration = node->_NewEnum;
    for (;;) {
        Ztl_variant_t key;
        ULONG count = 0;
        if (FAILED(enumeration->Next(1, &key, &count)) || !count) break;
        Ztl_bstr_t name(key);
        auto value = node->item[name];
        IUnknownPtr unknown = get_unknown(value);
        IWzCanvasPtr canvas;
        if (!unknown || SUCCEEDED(unknown.QueryInterface(__uuidof(IWzCanvas), &canvas))) continue;
        IWzPropertyPtr child;
        if (SUCCEEDED(unknown.QueryInterface(__uuidof(IWzProperty), &child))) AddAnimations(avatar, child, layers, depth + 1);
    }
}
void AddItemAnimations(void* avatar, IWzPropertyPtr root, std::vector<IWzGr2DLayerPtr>& layers) {
    if (!root) return;
    const int action = reinterpret_cast<int(__thiscall*)(void*, int*)>(
        addr::prism::kGetCurrentAction)(avatar, nullptr);
    Ztl_bstr_t name;
    if (action >= 0 && action < 162) reinterpret_cast<Ztl_bstr_t*(__cdecl*)(Ztl_bstr_t*, int)>(
        addr::prism::kActionNameFromCode)(&name, action);
    auto append = [&](const wchar_t* key) {
        if (!key) return;
        auto value = root->item[key];
        IUnknownPtr unknown = get_unknown(value);
        IWzPropertyPtr node;
        if (unknown && SUCCEEDED(unknown.QueryInterface(__uuidof(IWzProperty), &node)))
            AddAnimations(avatar, node, layers);
    };
    // The native two shapes: action/default folders, or direct numeric frames
    // (including the numeric sibling animations of follow-effect items).
    const size_t before = layers.size();
    append(name.GetBSTR());
    if (layers.size() != before) return;
    append(L"default");
    if (layers.size() != before) return;
    auto zero = root->item[L"0"];
    if (get_unknown(zero)) AddAnimations(avatar, root, layers);
}
class PrismWindow final : public CWnd {
    prismabi::Preview preview_;
    IWzCanvasPtr background_, lookBackground_, tracks_[3], chips_[2][3];
    IWzCanvasPtr thumb_, close_, okay_, cancel_, tabSprites_[2][3];
    IWzFontPtr fonts_[3];
    std::vector<IWzGr2DLayerPtr> effects_;
    int tab_ = 0, layer_ = 0, item_ = 0, skill_ = 0, inventoryType_ = 0, inventoryPosition_ = 0;
    int prismPosition_;
    PrismTint tint_;
    bool body_ = false, effect_ = false, absolute_ = false;
    bool restore_ = false, dragging_ = false, previewDirty_ = true;
    int slider_ = -1, anchorX_ = 0, anchorY_ = 0, dragX_ = -1, dragY_ = -1;
    int screenX_, screenY_, move_ = -1;
    int effectAction_ = -1, effectFacing_ = -1;
    bool focused_ = true, facingLeft_ = false;
    float previewX_ = 150, previewY_ = 207, verticalSpeed_ = 0;
    DWORD motionTime_ = GetTickCount();
    uint64_t observedRevision_ = 0;
    DWORD lastCast_ = 0;
    int castAction_ = 0;
    bool Ready() const { return tab_ >= 2 || (tab_ == 0 ? item_ > 0 && (body_ || effect_) : skill_ > 0); }
    int Key() const {
        if (tab_ >= 2) return -(tab_ - 1);
        return tab_ == 1 ? skill_ + 30000000 : item_ + (layer_ ? 10000000 : 0);
    }
    void LoadTint() {
        tint_ = Ready() ? WeaponTint_Get(prismabi::LocalCharacterId(), Key()) : PrismTint{};
        absolute_ = tint_.hue < 0;
        restore_ = false;
        previewDirty_ = true;
        InvalidateRect(nullptr);
    }
    void Font(unsigned int index, int height, unsigned int color) {
        PcCreateObject<IWzFontPtr>(L"Canvas#Font", fonts_[index], nullptr);
        fonts_[index]->Create(L"Dotum", height, color, Ztl_variant_t(L"B"));
    }
    void Text(IWzCanvasPtr canvas, int x, int y, const char* text, unsigned int font = 0) {
        canvas->DrawTextA(x, y, text, fonts_[font]);
    }
    void SetSlider(int row, int x) {
        const PrismTint before = tint_;
        const int position = (std::max)(0, (std::min)(kTrackWidth - 1, x - kTrackX));
        if (row == 0) {
            int degrees = position * 359 / (kTrackWidth - 1);
            tint_.hue = static_cast<int16_t>(absolute_ ? -(degrees + 1) : degrees);
        } else {
            const int amount = position * 200 / (kTrackWidth - 1) - 100;
            if (row == 1) tint_.chroma = static_cast<int8_t>(amount);
            else tint_.bright = static_cast<int8_t>(amount);
        }
        if (before == tint_ && !restore_) return;
        restore_ = false;
        previewDirty_ = true;
        InvalidateRect(nullptr);
    }
    void Apply() {
        if (!Ready() || !CapsAccepted(caps::kPrismSync) || prismabi::ItemId(5, prismPosition_) != 5782000) return;
        COutPacket packet(0x372E);
        packet.Encode1(static_cast<unsigned char>(tab_ == 0 ? (restore_ ? 2 : 1) : tab_ == 1 ? (restore_ ? 6 : 5) : (restore_ ? 4 : 3)));
        if (tab_ == 0) {
            if (prismabi::ItemId(inventoryType_, inventoryPosition_) != item_) return;
            packet.Encode1(static_cast<unsigned char>(inventoryType_));
            packet.Encode2(static_cast<unsigned short>(inventoryPosition_));
            packet.Encode4(static_cast<unsigned int>(item_));
        } else if (tab_ == 1) packet.Encode4(static_cast<unsigned int>(skill_));
        else packet.Encode1(static_cast<unsigned char>(tab_ - 2));
        if (!restore_) {
            packet.Encode2(static_cast<unsigned short>(tint_.hue));
            packet.Encode1(static_cast<unsigned char>(tint_.chroma));
            packet.Encode1(static_cast<unsigned char>(tint_.bright));
        }
        packet.Encode2(static_cast<unsigned short>(prismPosition_));
        if (tab_ == 0) packet.Encode1(static_cast<unsigned char>(layer_));
        Send(packet);
        Destroy();
    }
    int EffectAction() const {
        return preview_.avatar ? reinterpret_cast<int(__thiscall*)(void*, int*)>(
            addr::prism::kGetCurrentAction)(preview_.avatar, nullptr) : -1;
    }
    int EffectFacing() const {
        if (!preview_.avatar) return 0;
        auto* overlay = prismabi::At<IWzGr2DLayer*>(preview_.avatar, 0x10C8);
        return overlay ? overlay->flip : 0;
    }
    void BuildEffects() {
        effects_.clear();
        if (!preview_.avatar) return;
        effectAction_ = EffectAction();
        effectFacing_ = EffectFacing();
        wchar_t path[160];
        if (tab_ == 1 && skill_) {
            WeaponTint_BeginSkillSwap(preview_.avatar, skill_);
            struct End { ~End() { WeaponTint_EndSkillSwap(); } } end;
            swprintf_s(path, L"Skill/%03d.img/skill/%d", skill_ / 10000, skill_);
            auto node = prismabi::Property(path);
            if (!node) return;
            auto actionValue = node->item[L"action"];
            IUnknownPtr actionUnknown = get_unknown(actionValue);
            IWzPropertyPtr actions;
            if (actionUnknown && SUCCEEDED(actionUnknown.QueryInterface(__uuidof(IWzProperty), &actions))) actionValue = actions->item[L"0"];
            castAction_ = actionValue.vt == VT_BSTR
                ? prismabi::ActionNamed(actionValue.bstrVal) : -1;
            for (const wchar_t* name : {L"effect", L"effect0", L"effect1", L"affected", L"ball", L"hit"}) {
                auto value = node->item[name];
                IUnknownPtr unknown = get_unknown(value);
                IWzPropertyPtr animation;
                if (unknown && SUCCEEDED(unknown.QueryInterface(__uuidof(IWzProperty), &animation))) AddAnimations(preview_.avatar, animation, effects_);
            }
            // The skill's own WZ action selects the cast pose, not a made-up one.
            if (castAction_ >= 0) preview_.Action(castAction_);
            lastCast_ = GetTickCount();
        } else if (tab_ == 0 && item_ >= 5010000 && item_ <= 5019999) {
            // These native builders require a CUser; a detached CAvatar has none.
            // Use the same native animation factory against that item's real art.
            WeaponTint_BeginCashPreview(preview_.avatar, item_);
            struct End { ~End() { WeaponTint_EndCashPreview(); } } end;
            swprintf_s(path, L"Item/Cash/0501.img/%08d/effect", item_);
            AddItemAnimations(preview_.avatar, prismabi::Property(path), effects_);
        } else if (tab_ == 0 && effect_) {
            WeaponTint_BeginItemEffSwap(preview_.avatar, item_);
            struct End { ~End() { WeaponTint_EndItemEffSwap(); } } end;
            swprintf_s(path, L"Effect/ItemEff.img/%d/effect", item_);
            AddItemAnimations(preview_.avatar, prismabi::Property(path), effects_);
        }
    }
    void RefreshPreview(bool recreate) {
        if (!CapsAccepted(caps::kPrismSync)) return;
        if (recreate || !preview_.avatar) {
            if (preview_.avatar) WeaponTint_ClearPreview(preview_.avatar);
            effects_.clear();
            if (!preview_.Allocate()) return;
            WeaponTint_SetPreview(preview_.avatar, prismabi::LocalCharacterId(), Ready() ? Key() : 0, tint_);
            preview_.Initialize(m_pLayer, tab_ == 0 ? item_ : 0);
            move_ = -1;
        } else {
            WeaponTint_SetPreview(preview_.avatar, prismabi::LocalCharacterId(), Ready() ? Key() : 0, tint_);
            prismabi::HideField hidden;
            prismabi::Rebuild(preview_.avatar);
        }
        BuildEffects();
        previewDirty_ = false;
    }
public:
    ZALLOC_GLOBAL
    inline static CRTTI rtti{&CWnd::ms_RTTI_CWnd};
    PrismWindow(int position, int x, int y) : prismPosition_(position), screenX_(x), screenY_(y) {
        background_ = Art(L"backgrnd");
        lookBackground_ = Art(L"backgrndLook");
        tracks_[0] = Art(L"trackTone"); tracks_[1] = Art(L"trackChroma"); tracks_[2] = Art(L"trackBright");
        for (int layer = 0; layer < 2; ++layer) for (int state = 0; state < 3; ++state) {
            wchar_t path[96];
            swprintf_s(path, L"LayerBt/%s/%s", layer ? L"glow" : L"item", state == 0 ? L"normal" : state == 1 ? L"on" : L"off");
            chips_[layer][state] = Art(path);
        }
        // Missing required art is an integration error, not an excuse to paint
        // a placeholder panel or silently expose an invisible layer selector.
        if (!background_ || !tracks_[0] || !tracks_[1] || !tracks_[2]) _com_issue_error(E_FAIL);
        for (const auto& layer : chips_) for (const auto& chip : layer) if (!chip) _com_issue_error(E_FAIL);
        thumb_ = prismabi::Canvas(L"UI/Basic.img/Slider/thumbNormal");
        close_ = prismabi::Canvas(L"UI/UIWindow.img/Bag/BtClose/normal/0");
        okay_ = prismabi::Canvas(L"UI/Basic.img/BtOK2/normal/0");
        cancel_ = prismabi::Canvas(L"UI/Basic.img/BtCancel2/normal/0");
        for (int state = 0; state < 2; ++state) for (int piece = 0; piece < 3; ++piece) {
            wchar_t path[96];
            swprintf_s(path, L"UI/Basic.img/Tab2/%s%d",
                piece == 0 ? L"left" : piece == 1 ? L"fill" : L"right", state);
            tabSprites_[state][piece] = prismabi::Canvas(path);
            if (!tabSprites_[state][piece]) _com_issue_error(E_FAIL);
        }
        if (!thumb_ || !close_ || !okay_ || !cancel_) _com_issue_error(E_FAIL);
        Font(0, 11, 0xFF203853); Font(1, 12, 0xFFFFFFFF); Font(2, 10, 0xFF64748B);
        window = this;
        CWnd::CreateWnd(this, x, y, kWidth, kHeight, 10, 1, nullptr, 1);
        observedRevision_ = WeaponTint_Revision(prismabi::LocalCharacterId());
        RefreshPreview(true);
    }
    ~PrismWindow() override {
        if (preview_.avatar) WeaponTint_ClearPreview(preview_.avatar);
        if (window == this) window = nullptr;
    }
    const CRTTI* GetRTTI() const override { return &rtti; }
    int IsKindOf(const CRTTI* type) const override { return rtti.IsKindOf(type); }
    void OnDestroy() override {
        savedX = screenX_; savedY = screenY_;
        effects_.clear();
        if (preview_.avatar) WeaponTint_ClearPreview(preview_.avatar);
        preview_.Clear();
        if (window == this) window = nullptr;
        CWnd::OnDestroy();
    }
    void RetargetPrism(int position) { prismPosition_ = position; }
    bool Destination(void* destination) {
        const bool addressed = destination == this ||
            destination == static_cast<IUIMsgHandler*>(this);
        if (destination && !addressed) return false;
        POINT cursor{};
        auto* app = CWvsApp::GetInstance();
        if (app && GetCursorPos(&cursor) && ScreenToClient(app->m_hWnd, &cursor)) {
            dragX_ = cursor.x - screenX_;
            dragY_ = cursor.y - screenY_;
        }
        // A null native target is legitimate. Only the actual well may claim
        // that fallback, never an arbitrary location in the field behind us.
        return addressed || (tab_ < 2 && Inside(kWell, dragX_, dragY_));
    }
    bool ItemDrop(int type, int position) {
        if (tab_ != 0 || !Inside(kWell, dragX_, dragY_)) return true;
        if ((type != 1 && type != 5) || position < -32768 || position > 32767) return true;
        int id = prismabi::ItemId(type, position);
        if ((id / 1000000 != 1 || type != 1) && (type != 5 || id < 5010000 || id > 5019999)) return true;
        item_ = id; inventoryType_ = type; inventoryPosition_ = position;
        body_ = type == 1;
        effect_ = WeaponTint_ItemHasEffectArt(id);
        layer_ = body_ ? 0 : 1;
        LoadTint(); RefreshPreview(true);
        return true;
    }
    bool SkillDrop(int id) {
        if (tab_ != 1 || !Inside(kWell, dragX_, dragY_) || id <= 0) return true;
        void* data = prismabi::CharacterData();
        void* info = *reinterpret_cast<void**>(addr::prism::kSkillInfo);
        if (!data || !info || reinterpret_cast<int(__thiscall*)(void*, void*, int, void*)>(
                addr::prism::kGetSkillLevel)(info, data, id, nullptr) <= 0) return true;
        skill_ = id; CacheSkillIcon(); LoadTint(); RefreshPreview(true);
        return true;
    }
    void OnDraggableMove(int, IDraggable*, int rx, int ry) override { dragX_ = rx; dragY_ = ry; }
    int OnSetFocus(int focused) override { focused_ = focused != 0; return 1; }
    void OnKey(unsigned int key, unsigned int flags) override {
        if (key == VK_ESCAPE && !(flags & 0x80000000U)) { Destroy(); return; }
        // Preview receives the player's real key bindings, never field commands.
        if (flags & 0x80000000U) return;
        int scan = static_cast<int>((flags >> 16) & 255);
        if (scan == 0x36) scan = 0x2A;
        if (scan >= 89) return;
        void* keys = *reinterpret_cast<void**>(addr::prism::kFuncKeyMapped);
        if (!keys) return;
        const unsigned char type = prismabi::At<unsigned char>(keys, 4 + scan * 5);
        int action = 0;
        memcpy(&action, static_cast<unsigned char*>(keys) + 5 + scan * 5, sizeof(action));
        if (type == 5 && action == 53 && previewY_ >= 207) verticalSpeed_ = -555;
        if ((type == 5 && action == 52) || (type == 1 && action == skill_)) {
            if (tab_ == 1 && skill_ > 0) {
                if (castAction_ >= 0) preview_.Action(castAction_);
                lastCast_ = GetTickCount();
            } else preview_.Action(5); // stock swingO1; native one-shot expiry owns it
        }
    }
    void Update() override {
        if (!CapsAccepted(caps::kPrismSync)) return;
        if (previewDirty_) RefreshPreview(false);
        const bool left = focused_ && (GetAsyncKeyState(VK_LEFT) & 0x8000) != 0;
        const bool right = focused_ && (GetAsyncKeyState(VK_RIGHT) & 0x8000) != 0;
        DWORD now = GetTickCount();
        float dt = (std::min)(now - motionTime_, DWORD(100)) / 1000.0f;
        motionTime_ = now;
        if (left != right) {
            facingLeft_ = left;
            previewX_ = (std::max)(60.0f, (std::min)(240.0f, previewX_ + (left ? -125 : 125) * dt));
        }
        if (verticalSpeed_ != 0 || previewY_ < 207) {
            verticalSpeed_ += 2000 * dt;
            previewY_ += verticalSpeed_ * dt;
            if (previewY_ >= 207) { previewY_ = 207; verticalSpeed_ = 0; }
        }
        const int base = previewY_ < 207 ? 3 : left == right ? 2 : 1;
        const int move = (base << 1) | (facingLeft_ ? 1 : 0);
        if (move != move_) {
            preview_.Move(move); move_ = move;
        }
        preview_.Position(static_cast<int>(previewX_), static_cast<int>(previewY_));
        preview_.Update(); // CWndMan owns this once; the global Tick never repeats it
        if (tab_ == 0 && effect_ &&
            (effectAction_ != EffectAction() || effectFacing_ != EffectFacing())) BuildEffects();
        if (tab_ == 1 && skill_ && castAction_ >= 0 && now - lastCast_ >= 2000) {
            preview_.Action(castAction_); lastCast_ = now;
        }
    }
    void Sync() {
        uint64_t current = WeaponTint_Revision(prismabi::LocalCharacterId());
        if (current != observedRevision_) {
            observedRevision_ = current;
            // Keep an in-progress slider edit; only the baseline palette changes.
            previewDirty_ = true;
        }
    }
    void Draw(const RECT* rect) override {
        CWnd::Draw(rect);
        if (!CapsAccepted(caps::kPrismSync)) return;
        auto canvas = GetCanvas();
        if (!canvas) return;
        Blit(canvas, tab_ >= 2 && lookBackground_ ? lookBackground_ : background_, 0, 0);
        for (int i = 0; i < 5; ++i) {
            const int x = 8 + i * 57;
            auto& pieces = tabSprites_[i == tab_ ? 0 : 1];
            Blit(canvas, pieces[0], x, 24);
            canvas->CopyEx(x + 4, 24, pieces[1], CA_OVERWRITE, 49, 19, 0, 0, 1, 19);
            Blit(canvas, pieces[2], x + 53, 24);
            Text(canvas, x + 9, 29, kTabs[i], i == tab_ ? 0 : 2);
        }
        if (tab_ < 2) {
            Text(canvas, 76, 58, tab_ == 0 ? "Drop an equip or cash effect." : "Drop a learned skill.", 1);
            Text(canvas, 76, 76, "Preview your colour, then OK.", 1);
            if (tab_ == 0 && item_) CItemInfo::GetInstance()->DrawItemIconForSlot(canvas, item_, 24, 94, 0, 0, 0, 0, 0, 1);
            else if (tab_ == 1 && skill_) {
                // Icon is loaded on drop below; no WZ lookups during Draw.
                Blit(canvas, skillIcon_, 24, 61);
            }
        } else {
            Text(canvas, 45, 59, "Colour your look. No drop needed.", 1);
            Text(canvas, 52, 77, "Your original style stays intact.", 1);
        }
        if (tab_ == 0) for (int i = 0; i < 2; ++i)
            Blit(canvas, chips_[i][!(i ? effect_ : body_) ? 2 : layer_ == i ? 1 : 0], i ? 149 : 127, 222);
        Text(canvas, 18, 241, absolute_ ? "Hue: absolute (click to rotate)" : "Hue: rotate (click for absolute)", 2);
        for (int row = 0; row < 3; ++row) {
            Blit(canvas, tracks_[row], kTrackX, kTrackY[row]);
            int value = row == 0 ? (tint_.hue < 0 ? -tint_.hue - 1 : tint_.hue) : row == 1 ? tint_.chroma : tint_.bright;
            int x = row == 0 ? value * (kTrackWidth - 1) / 359 : (value + 100) * (kTrackWidth - 1) / 200;
            Blit(canvas, thumb_, kTrackX + x - 11, kTrackY[row] - 3);
            char label[20]; sprintf_s(label, "%d", value);
            Text(canvas, 266, kTrackY[row] - 2, label, 2);
        }
        Text(canvas, 79, 352, restore_ ? "[x] Restore original colour" : "[ ] Restore original colour", 2);
        Blit(canvas, okay_, 81, 376); Blit(canvas, cancel_, 172, 376); Blit(canvas, close_, 282, 6);
    }
    IWzCanvasPtr skillIcon_;
    void CacheSkillIcon() {
        wchar_t path[128];
        swprintf_s(path, L"Skill/%03d.img/skill/%d/icon", skill_ / 10000, skill_);
        skillIcon_ = prismabi::Canvas(path);
    }
    void OnMouseButton(unsigned int message, unsigned int param, int x, int y) override {
        if (message == WM_LBUTTONUP) { slider_ = -1; dragging_ = false; return; }
        if (message != WM_LBUTTONDOWN) { CWnd::OnMouseButton(message, param, x, y); return; }
        if ((x >= 282 && y < 20) || (x >= 156 && x < 236 && y >= 374 && y < 396)) { Destroy(); return; }
        if (x >= 65 && x < 145 && y >= 374 && y < 396) { Apply(); return; }
        if (y >= 24 && y < 44 && x >= 8 && x < 293) {
            tab_ = (std::min)(4, (x - 8) / 57); LoadTint(); RefreshPreview(true); return;
        }
        if (tab_ == 0 && y >= 222 && y < 236) {
            if (x >= 127 && x < 141 && body_) { layer_ = 0; LoadTint(); }
            if (x >= 149 && x < 163 && effect_) { layer_ = 1; LoadTint(); }
            return;
        }
        if (y >= 239 && y < 254) {
            absolute_ = !absolute_;
            const int degrees = tint_.hue < 0 ? -tint_.hue - 1 : tint_.hue;
            tint_.hue = static_cast<int16_t>(absolute_ ? -(degrees + 1) : degrees);
            restore_ = false; previewDirty_ = true; InvalidateRect(nullptr); return;
        }
        if (y >= 349 && y < 367) {
            restore_ = !restore_;
            tint_ = restore_ ? PrismTint{} : WeaponTint_Get(prismabi::LocalCharacterId(), Key());
            absolute_ = tint_.hue < 0; previewDirty_ = true; InvalidateRect(nullptr); return;
        }
        for (int row = 0; row < 3; ++row) if (Ready() && y >= kTrackY[row] - 5 && y < kTrackY[row] + 13 && x >= kTrackX - 6 && x <= kTrackX + kTrackWidth + 6) {
            slider_ = row; SetSlider(row, x); return;
        }
        if (y < 21) { dragging_ = true; anchorX_ = x; anchorY_ = y; }
    }
    int OnMouseMove(int x, int y) override {
        if (!(GetAsyncKeyState(VK_LBUTTON) & 0x8000)) { slider_ = -1; dragging_ = false; }
        if (slider_ >= 0 && (GetAsyncKeyState(VK_LBUTTON) & 0x8000)) SetSlider(slider_, x);
        if (dragging_) {
            int dx = x - anchorX_, dy = y - anchorY_;
            m_pLayer->RelOffset(dx, dy, Ztl_variant_t(), Ztl_variant_t());
            screenX_ += dx; screenY_ += dy;
        }
        return 1;
    }
};
using SkillDropFn = int(__thiscall*)(void*, IUIMsgHandler*, IUIMsgHandler*, int, int);
auto skillDrop = reinterpret_cast<SkillDropFn>(addr::prism::kSkillOnDropped);
bool ReadSkillId(void* draggable, int& id) {
    if (!draggable) return false;
    __try { id = prismabi::At<int>(draggable, 0x18); return true; }
    __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}
int __fastcall SkillDropHook(void* draggable, void*, IUIMsgHandler* from, IUIMsgHandler* to, int x, int y) {
    if (CapsAccepted(caps::kPrismSync) && window && window->Destination(to)) {
        int id = 0;
        if (ReadSkillId(draggable, id) && ColorPrism_HandleSkillDrop(to, id)) return 1;
    }
    return skillDrop(draggable, from, to, x, y);
}
} // namespace
bool ColorPrism_IsPrismItem(int item) { return item == 5782000 && CapsAccepted(caps::kPrismSync); }
void ColorPrism_OnUse(int position, int item) {
    if (!ColorPrism_IsPrismItem(item) || position <= 0 || position > 32767 || prismabi::ItemId(5, position) != item) return;
    if (window) { window->RetargetPrism(position); return; }
    int x = savedX < 0 ? (get_screen_width() - kWidth) / 2 : savedX;
    int y = savedY;
    x = (std::max)(0, (std::min)(x, get_screen_width() - kWidth));
    y = (std::max)(0, (std::min)(y, get_screen_height() - kHeight));
    new PrismWindow(position, x, y);
    Request();
}
bool ColorPrism_HandleItemDrop(IUIMsgHandler* destination, int type, int position) {
    return CapsAccepted(caps::kPrismSync) && window && window->Destination(destination)
        ? window->ItemDrop(type, position) : false;
}
bool ColorPrism_HandleSkillDrop(void* destination, int skillId) {
    return CapsAccepted(caps::kPrismSync) && window && window->Destination(destination)
        ? window->SkillDrop(skillId) : false;
}
void ColorPrism_Reset() { if (window) window->Destroy(); }
void ColorPrism_Tick() {
    if (!CapsAccepted(caps::kPrismSync)) { ColorPrism_Reset(); return; }
    if (window) window->Sync();
}
bool AttachColoringPrismMod() { return ATTACH_HOOK(skillDrop, SkillDropHook); }

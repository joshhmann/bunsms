// Native-test-only link shims (slot24 suite). The regression never calls
// recalc_stats/find_equipslot (icon/anim paths need NX + GL); these satisfy
// the linker's Cache<BulletData> teardown (~Texture chain) without touching
// engine semantics. Any change to the model's construction-time coupling
// surfaces here as a loud link error, not a silent pass.
namespace jrc
{
    class Texture
    {
    public:
        ~Texture();
    };
    Texture::~Texture() {}
}

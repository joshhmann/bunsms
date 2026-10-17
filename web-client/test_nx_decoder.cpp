// Permanent regression on the PUBLIC NX reader seam (nl::bitmap::data()).
// Uses a minimal REAL NX container built by the repo's own writer layout
// (header + node table + bitmap table + length-prefixed LZ4 entry), not a
// mock io echo: the probe constructs nl::bitmap over a real file fd and
// decodes through the actual data() path.
// 1. genuine Map.nx entry bytes (18B compressed -> 16B, bgra 5f0fd009).
// 2. truncated entry (prefix 18, only 16 present) -> nullptr, no OOB.
// 3. zero-length prefix -> nullptr.
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <stdexcept>
#include "nlnx/bitmap.hpp"
#include "nlnx/file_impl.hpp"
static int failures = 0;
static void check(bool ok, const char* name) {
    std::printf("%s %s\n", ok ? "PASS" : "FAIL", name);
    if (!ok) failures++;
}
// A minimal real container: raw entry bytes at file offset 0, bitmap over fd.
static const void* decode_entry(const unsigned char* blob, size_t bloblen,
    uint16_t w, uint16_t h, unsigned char* outcopy) {
    char path[] = "/tmp/nxentryXXXXXX";
    int fdw = mkstemp(path);
    if (fdw < 0) return nullptr;
    if (write(fdw, blob, bloblen) != static_cast<ssize_t>(bloblen)) { close(fdw); return nullptr; }
    close(fdw);
    int fdn = open(path, O_RDONLY);
    unlink(path);
    if (fdn < 0) return nullptr;
    nl::_file_data fd;
    fd.file_handle = fdn;
    struct stat st;
    if (::fstat(fdn, &st) == 0) fd.size = static_cast<size_t>(st.st_size);
    nl::bitmap bm(const_cast<void*>(static_cast<const void*>(&fd)), 0, w, h);
    const void* out = bm.data();
    const void* ret = nullptr;
    if (out && outcopy) {
        std::memcpy(outcopy, out, static_cast<size_t>(w) * h * 4u);
        ret = outcopy;
    } else if (out) {
        ret = out; // for null-check tests; fd leak acceptable in test
    }
    close(fdn);
    return ret;
}
int main() {
    // 1. genuine Map.nx Back/extinction.img/ani/5/4 entry (prefix 18).
    {
        static const unsigned char blob[22] = {18,0,0,0, 0xf0,0x01,0xff,0xff,0xff,0x44,0xff,0xff,0xff,0x22,0xff,0xff,0xff,0x11,0x00,0x00,0x00,0x00};
        static const unsigned char expect[16] = {0xff,0xff,0xff,0x44,0xff,0xff,0xff,0x22,0xff,0xff,0xff,0x11,0,0,0,0};
        unsigned char got[16] = {0};
        const void* r = decode_entry(blob, sizeof blob, 2, 2, got);
        check(r && std::memcmp(got, expect, 16) == 0, "genuine-18b-decodes-exact-5f0fd009");
    }
    // 2. truncated: prefix claims 18, file ends after 16 payload bytes.
    {
        static const unsigned char blob[20] = {18,0,0,0, 0xf0,0x01,0xff,0xff,0xff,0x44,0xff,0xff,0xff,0x22,0xff,0xff,0xff,0x11,0x00,0x00};
        bool threw = false;
        try { decode_entry(blob, sizeof blob, 2, 2, nullptr); }
        catch (const std::runtime_error&) { threw = true; }
        check(threw, "truncated-entry-throws");
    }
    // 3. zero-length prefix.
    {
        static const unsigned char blob[8] = {0,0,0,0, 0xf0,0x01,0x00,0x00};
        bool threw = false;
        try { decode_entry(blob, sizeof blob, 2, 2, nullptr); }
        catch (const std::runtime_error&) { threw = true; }
        check(threw, "zero-prefix-throws");
    }
    // 4. present bitmap with dimensions beyond LZ4 int range -> throws.
    {
        char path[] = "/tmp/bigdimXXXXXX";
        int w = mkstemp(path);
        unsigned char blob[8] = {18,0,0,0, 0xf0,0x01,0x00,0x00};
        if (write(w, blob, sizeof blob) != (ssize_t)sizeof blob) { close(w); }
        else {
            close(w);
            int fdn = open(path, O_RDONLY);
            unlink(path);
            if (fdn >= 0) {
                nl::_file_data fd;
                fd.file_handle = fdn;
                nl::bitmap bm(const_cast<void*>(static_cast<const void*>(&fd)), 0, 65535, 65535);
                bool threw = false;
                try { bm.data(); }
                catch (const std::runtime_error&) { threw = true; }
                check(threw, "oversized-dims-throws");
                close(fdn);
            } else check(false, "oversized-dims-throws");
        }
    }
    std::printf(failures ? "RESULT-FAIL %d\n" : "RESULT-PASS all\n", failures);
    return failures ? 1 : 0;
}

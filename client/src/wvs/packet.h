#pragma once
#include <cstring>
#include <string>
#include "../ztl/ztl.h"


// CInPacket surface (spec §3.0 adaptation point): bounds-checked Decode<T>
// over the raw buffer — deliberately NOT via the native Decode1/2/4, which
// raise _com_error on short reads and kill the receive thread silently.
// Plus CanRead / GetOffset / SetOffset, and Peek2/SkipOpcode for the
// dispatcher + module routes (packets arrive with offset AT the opcode).
class CInPacket {
protected:
    int m_bLoopback;
    int m_nState;
    ZArray<unsigned char> m_aRecvBuff;
    unsigned short m_uLength;
    unsigned short m_uRawSeq;
    unsigned short m_uDataLen;
    size_t m_uOffset;

public:
    bool CanRead(size_t n) const { return m_uOffset + n <= m_uLength; }

    size_t GetOffset() const { return m_uOffset; }
    void SetOffset(size_t off) { m_uOffset = off; }

    // Peek the next 2 bytes without consuming (dispatcher opcode read).
    unsigned short Peek2() const {
        unsigned short v = 0;
        if (CanRead(2))
            memcpy(&v, &m_aRecvBuff[m_uOffset], 2);
        return v;
    }

    template <typename T>
    bool Decode(T& out) {
        if (!CanRead(sizeof(T)))
            return false;
        memcpy(&out, &m_aRecvBuff[m_uOffset], sizeof(T));
        m_uOffset += sizeof(T);
        return true;
    }

    bool Decode1(unsigned char& out) { return Decode(out); }
    bool Decode2(unsigned short& out) { return Decode(out); }
    bool Decode4(unsigned int& out) { return Decode(out); }
    bool Decode4(int& out) { return Decode(out); }

    bool DecodeStr(std::string& out) {
        unsigned short len = 0;
        if (!Decode2(len))
            return false;
        if (!CanRead(len))
            return false;
        out.assign(reinterpret_cast<const char*>(&m_aRecvBuff[m_uOffset]), len);
        m_uOffset += len;
        return true;
    }

    // Consume the 2-byte opcode prefix (all bundled handlers skip it).
    bool SkipOpcode() {
        if (!CanRead(2))
            return false;
        m_uOffset += 2;
        return true;
    }
};


class COutPacket {
protected:
    int m_bLoopback;
    ZArray<unsigned char> m_aSendBuff;
    unsigned int m_uOffset;
    int m_bIsEncryptedByShanda;

public:
    explicit COutPacket(int nType) : m_aSendBuff(0x100) {
        Init(nType, 0, 0);
    }
    void Encode1(unsigned char n) {
        EncodeBuffer(&n, 1);
    }
    void Encode2(unsigned short n) {
        EncodeBuffer(&n, 2);
    }
    void Encode4(unsigned int n) {
        EncodeBuffer(&n, 4);
    }
    void EncodeStr(ZXString<char> s) {
        int nLen = s.GetLength();
        if (nLen < 0) nLen = 0;
        if (nLen > 0xFFFF) nLen = 0xFFFF;
        unsigned short n = static_cast<unsigned short>(nLen);
        Encode2(n);
        EncodeBuffer(s, n);
    }
    void EncodeBuffer(const void* p, size_t uSize) {
        EnlargeBuffer(uSize);
        memcpy(&m_aSendBuff[m_uOffset], p, uSize);
        m_uOffset += uSize;
    }
    void Init(int nType, int bLoopback, int bTypeHeader1Byte) {
        m_bLoopback = bLoopback;
        m_uOffset = 0;
        if (nType != 0x7FFFFFFF) {
            if (bTypeHeader1Byte) {
                // 1-byte header: opcodes using it are < 0x100 by protocol.
                unsigned char n1 = static_cast<unsigned char>(nType & 0xFF);
                Encode1(n1);
            } else {
                // 2-byte header: opcodes are < 0x10000 by protocol.
                unsigned short n2 = static_cast<unsigned short>(nType & 0xFFFF);
                Encode2(n2);
            }
        }
        m_bIsEncryptedByShanda = 0;
    }

protected:
    void EnlargeBuffer(size_t uSize) {
        size_t uCur = m_aSendBuff.GetCount();
        size_t uReq = m_uOffset + uSize;
        if (uCur < uReq) {
            do {
                uCur *= 2;
            } while (uCur < uReq);
            m_aSendBuff.Realloc(uCur, 0);
        }
    }
};

static_assert(sizeof(COutPacket) == 0x10);
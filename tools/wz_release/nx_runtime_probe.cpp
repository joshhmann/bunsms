// Offline independent acceptance adapter for the browser's UNMODIFIED nlnx reader.
// Emits framed scalar/decoded-media bytes, not a second NX parser or writer.
#include <nlnx/file.hpp>
#include <nlnx/node.hpp>
#include <nlnx/bitmap.hpp>
#include <nlnx/audio.hpp>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

int main(int argc, char** argv) {
    try {
        if (argc != 3) throw std::runtime_error("file.nx exact-paths.txt");
        const std::uint16_t endian = 1;
        if (*reinterpret_cast<const unsigned char*>(&endian) != 1)
            throw std::runtime_error("Acceptance protocol requires little-endian scalar ABI");
        nl::file file(argv[1]);
        nl::node root = file.root();
        if (!root) throw std::runtime_error("Runtime could not open populated NX");
        std::ifstream input(argv[2]);
        if (!input) throw std::runtime_error("Missing exact-path requests");
        std::string path;
        std::size_t ordinal = 0;
        while (std::getline(input, path)) {
            nl::node node = root;
            for (std::size_t start = 0; start < path.size();) {
                const auto end = path.find('/', start);
                if (end != std::string::npos) path[end] = '\0';
                node = node[path.c_str() + start];
                if (end != std::string::npos) path[end] = '/';
                if (!node) throw std::runtime_error("Missing runtime node at request " + std::to_string(ordinal));
                if (end == std::string::npos) break;
                start = end + 1;
            }
            const auto kind = static_cast<unsigned>(node.data_type());
            std::int64_t integer = 0;
            double real = 0;
            std::int32_t vector[2] = {};
            std::string text;
            const void* bytes = nullptr;
            std::size_t length = 0;
            unsigned width = 0, height = 0;
            switch (kind) {
                case 0: break;
                case 1: integer = node.get_integer(); bytes = &integer; length = sizeof(integer); break;
                case 2: real = node.get_real(); bytes = &real; length = sizeof(real); break;
                case 3: text = node.get_string(); bytes = text.data(); length = text.size(); break;
                case 4: vector[0] = node.x(); vector[1] = node.y(); bytes = vector; length = sizeof(vector); break;
                case 5: {
                    const auto bitmap = node.get_bitmap();
                    width = bitmap.width(); height = bitmap.height(); length = bitmap.length(); bytes = bitmap.data();
                    if (!width || !height || !length || !bytes) throw std::runtime_error("Runtime canvas decode failed at " + path);
                    break;
                }
                case 6: {
                    const auto audio = node.get_audio();
                    length = audio.length(); bytes = audio.data();
                    if (!length || !bytes) throw std::runtime_error("Runtime audio read failed at " + path);
                    break;
                }
                default: throw std::runtime_error("Unsupported actual runtime node type");
            }
            std::cout << ordinal++ << '\t' << kind << '\t' << node.size() << '\t'
                      << width << '\t' << height << '\t' << length << '\n';
            if (length) std::cout.write(static_cast<const char*>(bytes), static_cast<std::streamsize>(length));
            std::cout.put('\n');
            if (!std::cout) throw std::runtime_error("Runtime acceptance output failed");
        }
        if (!input.eof()) throw std::runtime_error("Runtime request read failed");
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}

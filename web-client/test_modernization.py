"""Native regressions against the exact repository-owned Journey patch stack."""
import io
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


class ModernizationTests(unittest.TestCase):
    def test_actual_engine_seams(self):
        root = Path(__file__).resolve().parent
        vendor = root / "vendor/maplestory-wasm"
        archive = subprocess.run(
            ["git", "-C", str(vendor), "archive", "--format=tar",
             "8eece1d1fc43afa48e12df56b4719ca63af88e0b"],
            check=True, capture_output=True,
        ).stdout
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            with tarfile.open(fileobj=io.BytesIO(archive)) as snapshot:
                snapshot.extractall(source, filter="data")
            for name in ("remote-movement.patch", "deployed-npc-chat.patch",
                         "browser-modernization.patch", "inventory-equipment.patch",
                         "shop-storage.patch"):
                patch = root / "patches" / name
                subprocess.run(["git", "apply", "--check", str(patch)],
                               cwd=source, check=True)
                subprocess.run(["git", "apply", str(patch)],
                               cwd=source, check=True)
            client = source / "src/client"
            suites = {
                "npc": [client / "Net/InPacket.cpp", client / "Net/OutPacket.cpp"],
                "viewport": [client / "Gameplay/Camera.cpp"],
                "pic": [client / "Net/InPacket.cpp", client / "Net/OutPacket.cpp"],
                "movement": [client / "Net/InPacket.cpp",
                             client / "Net/Handlers/Helpers/MovementParser.cpp"],
                "shop_storage": [client / "Net/InPacket.cpp", client / "Net/OutPacket.cpp",
                                 source / "src/client/Character/Inventory/InventoryType.cpp"],
                "inventory_equipment": [client / "Net/InPacket.cpp",
                                        client / "Character/Inventory/InventoryType.cpp"],
            }
            for name, units in suites.items():
                with self.subTest(suite=name):
                    binary = source / (name + "-test")
                    flags = ["-std=c++17", "-Wall", "-Wextra", "-Werror", "-O2"]
                    if name in ("shop_storage", "inventory_equipment"):
                        # EnumMap transitively uses deprecated std::iterator;
                        # the engine CMake build does not promote it.
                        flags.append("-Wno-error=deprecated-declarations")
                    subprocess.run([
                        "g++", *flags,
                        "-I", str(client), "-I", str(source / "src"),
                        str(root / ("test_" + name + ".cpp")),
                        *map(str, units), "-o", str(binary),
                    ], check=True)
                    subprocess.run([str(binary)], check=True)


if __name__ == "__main__":
    unittest.main()

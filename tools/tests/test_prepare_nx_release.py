import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("prepare_nx_release", Path(__file__).parents[1] / "prepare_nx_release.py")
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


class CandidateInputTests(unittest.TestCase):
    def test_copy_checks_independent_expected_bytes_before_candidate_use(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, output = root / "input.wz", root / "candidate.wz"
            source.write_bytes(b"producer bytes")
            expected = bridge.metadata(source)
            bridge.copy_verified(source, output, expected)
            self.assertEqual(output.read_bytes(), b"producer bytes")
            self.assertEqual(output.stat().st_mode & 0o222, 0)
            output.chmod(0o600)
            output.unlink()
            source.write_bytes(b"tampered bytes")
            with self.assertRaisesRegex(ValueError, "hash/size mismatch"):
                bridge.copy_verified(source, output, expected)

    def test_no_snapshot_source_symlink_or_path_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "real").write_bytes(b"bytes")
            (root / "link").symlink_to(root / "real")
            for key in ("../real", "/real", "link", "a/../real", "./real"):
                with self.subTest(key=key), self.assertRaises((ValueError, OSError)):
                    bridge.regular_beneath(root, key)

    def test_full_baseline_requires_exact_observed_cohort_and_hashes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, destination = root / "baseline", root / "candidate"
            source.mkdir()
            destination.mkdir()
            (source / "Base.nx").write_bytes(b"baseline")
            observed = root / "observed.json"
            observed.write_text(json.dumps({"files": [{"name": "Base.nx", **bridge.metadata(source / "Base.nx")}] }))
            with self.assertRaisesRegex(ValueError, "complete 16-file"):
                bridge.baseline_snapshot(source, observed, destination, bridge.NX_NAMES)
            self.assertEqual(list(destination.iterdir()), [])

    def test_native_snapshot_verifies_approved_list_archive_in_complete_input(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, destination = root / "baseline", root / "candidate"
            source.mkdir()
            destination.mkdir()
            names = bridge.WZ_NAMES | {"List.wz"}
            for name in names:
                (source / name).write_bytes(name.encode())
            observed = root / "observed.json"
            observed.write_text(json.dumps({"files": [{"name": name, **bridge.metadata(source / name)} for name in names]}))
            bridge.baseline_snapshot(source, observed, destination, bridge.WZ_NAMES, native_extras=True)
            self.assertEqual({path.name for path in destination.iterdir()}, names)
            self.assertEqual((destination / "List.wz").read_bytes(), b"List.wz")

    def test_grouped_item_requires_exact_subtree_and_ui_is_never_mutable(self):
        operation = {"target_wz": "Item.wz", "target_image": "Etc/0409.img", "op": "import_image"}
        with self.assertRaisesRegex(ValueError, "Grouped Item"):
            bridge.approved_operations([operation])
        operation.update(op="set_subtree", target_node="04090001")
        self.assertEqual(bridge.approved_operations([operation]), [operation])
        for archive in ("UI.wz", "Effect.wz"):
            with self.subTest(archive=archive), self.assertRaises(ValueError):
                bridge.approved_operations([{**operation, "target_wz": archive}])

    def test_unsafe_operation_node_is_rejected(self):
        for node in ("../other", "/other", "a//b", "a/./b", "a\\b", "*"):
            with self.subTest(node=node), self.assertRaises(ValueError):
                bridge.approved_operations([{"target_wz": "String.wz", "target_image": "Eqp.img", "op": "set_subtree", "target_node": node}])


@unittest.skipUnless(os.environ.get("NX_BRIDGE_FIXTURE_REQUEST"), "Requires approved genuine pinned-tool native/NX fixture; no fake converter substituted")
class GenuinePinnedToolFixture(unittest.TestCase):
    def test_actual_converter_merger_produces_verified_complete_candidate(self):
        request = json.loads(Path(os.environ["NX_BRIDGE_FIXTURE_REQUEST"]).read_text())
        authority = Path(os.environ["LAUNCHER_MANIFEST_PATH"])
        before = authority.read_bytes()
        baseline = Path(os.environ["NX_BASELINE_DIR"])
        original = {name: bridge.metadata(baseline / name) for name in bridge.NX_NAMES}
        result = bridge.prepare(request)
        self.assertTrue(result["success"])
        self.assertEqual({row["name"] for row in result["files"]}, bridge.NX_NAMES)
        for row in result["files"]:
            self.assertEqual(bridge.metadata(Path(os.environ["ASSET_DIR"]) / row["relativePath"]), {"hash": row["hash"], "size": row["size"]})
        self.assertEqual(authority.read_bytes(), before, "Preparation must not commit authority")
        self.assertEqual({name: bridge.metadata(baseline / name) for name in bridge.NX_NAMES}, original)
        ui = next(row for row in result["files"] if row["name"] == "UI.nx")
        self.assertEqual({"hash": ui["hash"], "size": ui["size"]}, original["UI.nx"])


if __name__ == "__main__":
    unittest.main()

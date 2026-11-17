"""通过真实发行包 CLI 验证安装、回滚和离线可重复重建。"""
import hashlib
import importlib.util
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("foobox_release", ROOT / "tools/foobox.py")
foobox = importlib.util.module_from_spec(spec)
spec.loader.exec_module(foobox)


class ReleaseTest(unittest.TestCase):
    def test_extracted_package_install_rollback_and_offline_rebuild(self):
        archive = foobox.package()
        original_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory(prefix="foobox 发行包 中文 ") as temp:
            base = Path(temp)
            with zipfile.ZipFile(archive) as z:
                self.assertIsNone(z.testzip())
                z.extractall(base)
            bundle = base / ("foobox-macos-" + foobox.VERSION)
            source = bundle / "source"
            for location in (bundle, source):
                self.assertTrue((location / "README.zh-CN.md").is_file())
                self.assertIn("README.zh-CN.md", (location / "README.md").read_text())
            profile = base / "existing profile 中文"
            data = profile / "foobox-macos/data/common.cfg"
            data.parent.mkdir(parents=True)
            data.write_text('{"LineHeight":42}', encoding="utf-8")
            cli = ["python3", str(source / "tools/foobox.py")]
            for action in ("install", "rollback"):
                result = subprocess.run(cli + [action, "--profile", str(profile)], cwd=base, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(data.read_text(), '{"LineHeight":42}')
                self.assertEqual((profile / "foobox-macos/host.js").exists(), action == "install")
            self.assertFalse((source / ".deps").exists())
            result = subprocess.run(cli + ["package"], cwd=base, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            rebuilt = source / "dist" / archive.name
            self.assertEqual(hashlib.sha256(rebuilt.read_bytes()).hexdigest(), original_hash)


if __name__ == "__main__":
    unittest.main()

"""检查真实构建产物、用户数据保留、安装失败与回滚。"""
import importlib.util
import json
import tempfile
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("foobox", ROOT / "tools/foobox.py")
foobox = importlib.util.module_from_spec(spec)
spec.loader.exec_module(foobox)


class BuildTest(unittest.TestCase):
    def test_upstream_is_locked(self):
        foobox.verify_upstream(ROOT / "upstream/foobox-cn")

    def test_patch_rejects_drift(self):
        with self.assertRaisesRegex(ValueError, "补丁锚点"):
            foobox.replace_once("a a", "a", "b", "test")
        with self.assertRaisesRegex(ValueError, "补丁锚点"):
            foobox.transform("js_common/getconfig.js", "changed")

    def test_mac_entrypoints_are_real_upstream(self):
        bundle = ROOT / "build/foobox-macos"
        self.assertTrue((bundle / "manifest.json").is_file(), "先运行 build")
        profile = bundle / "profile"
        cfg = (profile / "foobox-macos/js_common/getconfig.js").read_text()
        self.assertNotIn("fb.Window", cfg)
        self.assertIn("cfg_map.winFrame = 0", cfg)
        settings = (profile / "foobox-macos/js_panels/jsplaylist/WSHsettings.js").read_text()
        self.assertNotIn("fb.Window", settings)
        playlist = (profile / "foobox-macos/js_panels/jsplaylist.js").read_text()
        self.assertIn('images\\\\Genre', playlist)
        browser = (profile / "foobox-macos/js_panels/jssb.js").read_text()
        self.assertIn("fooboxHiDPI.bytes(img)", browser)
        for script in (playlist, browser):
            self.assertIn("albumart_cache_hidpi_v1_", script)
            self.assertIn("fooboxHiDPI.density()", script)
        for name in ("Controls", "Playlist", "Manager", "Browser", "BrowserList", "Info"):
            entry = (profile / "foo_ui_panels/foobox-macos/js" / (name + ".js")).read_text()
            self.assertIn("host.js", entry)
            self.assertIn("js_panels/", entry)
        manifest = json.loads((bundle / "manifest.json").read_text())
        for rel, sha in manifest["profile_files"].items():
            self.assertEqual(foobox.digest(profile / rel), sha, rel)


class InstallTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="foobox 中文 ")
        self.base = Path(self.temp.name)
        self.profile = self.base / "已有 profile"
        self.bundle = self.base / "bundle"
        self.rel = "foobox-macos/js_panels/example.js"
        source = self.bundle / "profile" / self.rel
        source.parent.mkdir(parents=True)
        source.write_text("新脚本")
        foobox.dump(self.bundle / "manifest.json", {"profile_files": {self.rel: foobox.digest(source)}})

    def tearDown(self):
        self.temp.cleanup()

    def test_preserve_data_and_restore_old_files(self):
        old = self.profile / self.rel
        old.parent.mkdir(parents=True)
        old.write_text("旧脚本")
        data = self.profile / "foobox-macos/data/common.cfg"
        data.parent.mkdir()
        data.write_text('{"用户设置":true}')
        config = self.profile / "config.sqlite"
        config.write_bytes(b"existing settings")
        backup = foobox.install(self.bundle, self.profile)
        self.assertEqual(old.read_text(), "新脚本")
        self.assertEqual(data.read_text(), '{"用户设置":true}')
        foobox.rollback(self.profile, backup)
        self.assertEqual(old.read_text(), "旧脚本")
        self.assertEqual(config.read_bytes(), b"existing settings")
        self.assertEqual(data.read_text(), '{"用户设置":true}')

    def test_new_install_rollback_keeps_generated_data(self):
        foobox.install(self.bundle, self.profile)
        data = self.profile / "foobox-macos/data/test.json"
        data.parent.mkdir()
        data.write_text("运行后产生")
        foobox.rollback(self.profile)
        self.assertFalse((self.profile / self.rel).exists())
        self.assertEqual(data.read_text(), "运行后产生")

    def test_corrupt_payload_does_not_write_profile(self):
        (self.bundle / "profile" / self.rel).write_text("损坏文件")
        with self.assertRaisesRegex(ValueError, "校验失败"):
            foobox.install(self.bundle, self.profile)
        self.assertFalse(self.profile.exists())

    def test_missing_component_does_not_write_profile(self):
        manifest = json.loads((self.bundle / "manifest.json").read_text())
        manifest["assets"] = {"foo_js_panel_1.9.0.fb2k-component": {"sha256": "missing"}}
        foobox.dump(self.bundle / "manifest.json", manifest)
        with self.assertRaisesRegex(ValueError, "组件缺失"):
            foobox.install(self.bundle, self.profile)
        self.assertFalse(self.profile.exists())

    def test_manifest_cannot_replace_user_settings_or_player_config(self):
        for rel in ("config.sqlite", "foobox-macos/data/common.cfg"):
            source = self.bundle / "profile" / rel
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("不应该写入")
            foobox.dump(self.bundle / "manifest.json", {"profile_files": {rel: foobox.digest(source)}})
            with self.assertRaises(ValueError):
                foobox.install(self.bundle, self.profile)
            self.assertFalse(self.profile.exists())

    def test_path_escape_and_symlink_are_rejected(self):
        with self.assertRaises(ValueError):
            foobox.safe_target(self.profile, "../outside")
        outside = self.base / "outside"
        outside.mkdir()
        self.profile.mkdir()
        (self.profile / "foobox-macos").symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "符号链接"):
            foobox.install(self.bundle, self.profile)
        self.assertEqual(list(outside.iterdir()), [])

    def test_failed_second_write_restores_entire_install(self):
        second = "foobox-macos/js_panels/second.js"
        source = self.bundle / "profile" / second
        source.write_text("second")
        manifest = json.loads((self.bundle / "manifest.json").read_text())
        manifest["profile_files"][second] = foobox.digest(source)
        foobox.dump(self.bundle / "manifest.json", manifest)
        old = self.profile / self.rel
        old.parent.mkdir(parents=True)
        old.write_text("原来的内容")
        actual = foobox.shutil.copy2

        def fail_second(src, dest, *args, **kwargs):
            if Path(src).resolve() == source.resolve():
                Path(dest).write_text("复制到一半")
                raise OSError("模拟磁盘错误")
            return actual(src, dest, *args, **kwargs)

        with mock.patch.object(foobox.shutil, "copy2", side_effect=fail_second):
            with self.assertRaisesRegex(OSError, "磁盘错误"):
                foobox.install(self.bundle, self.profile)
        self.assertEqual(old.read_text(), "原来的内容")
        self.assertFalse((self.profile / second).exists())
        self.assertEqual(list(self.profile.rglob(".foobox-copy-*")), [])
        attempts = list((self.profile / ".foobox-macos-backups").glob("*/state.json"))
        self.assertTrue((attempts[0].parent / "restored").is_file())
        with self.assertRaisesRegex(ValueError, "没有可回滚"):
            foobox.rollback(self.profile)

    def test_failed_rollback_restores_current_version(self):
        second = "foobox-macos/js_panels/second.js"
        payload = self.bundle / "profile" / second
        payload.write_text("second new")
        manifest = json.loads((self.bundle / "manifest.json").read_text())
        manifest["profile_files"][second] = foobox.digest(payload)
        foobox.dump(self.bundle / "manifest.json", manifest)
        for rel in (self.rel, second):
            target = self.profile / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("old")
        backup = foobox.install(self.bundle, self.profile)
        actual = foobox.atomic_copy

        def fail_second(source, dest):
            if Path(source) == backup / "files" / second:
                raise OSError("回滚磁盘错误")
            return actual(source, dest)

        with mock.patch.object(foobox, "atomic_copy", side_effect=fail_second):
            with self.assertRaisesRegex(OSError, "回滚磁盘错误"):
                foobox.rollback(self.profile, backup)
        self.assertEqual((self.profile / self.rel).read_text(), "新脚本")
        self.assertEqual((self.profile / second).read_text(), "second new")
        self.assertFalse((backup / "restored").exists())
        foobox.rollback(self.profile, backup)
        self.assertEqual((self.profile / self.rel).read_text(), "old")
        self.assertEqual((self.profile / second).read_text(), "old")

    def test_rollback_must_be_lifo_and_cannot_repeat(self):
        first = foobox.install(self.bundle, self.profile)
        second = foobox.install(self.bundle, self.profile)
        with self.assertRaisesRegex(ValueError, "最近一次"):
            foobox.rollback(self.profile, first)
        foobox.rollback(self.profile, second)
        with self.assertRaisesRegex(ValueError, "已经回滚"):
            foobox.rollback(self.profile, second)
        self.assertTrue((self.profile / self.rel).is_file())
        foobox.rollback(self.profile, first)
        self.assertFalse((self.profile / self.rel).exists())


if __name__ == "__main__":
    unittest.main()

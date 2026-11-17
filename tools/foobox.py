#!/usr/bin/env python3
"""foobox macOS：固定源码构建、打包、安装与回滚。仅使用 Python 标准库。"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
VERSION = "0.1.1"
REVISION = "4a2d5e0ed8caea5265a6471d8e41d6ddeffb44c8"
PINS = {
    "foobox-cn": ("dream7180/foobox-cn", REVISION, "upstream/foobox-cn"),
    "foo_js_panel": ("santiagorod92/foo_js_panel", "6ac0a6450917f962098517536b5e40bd47ef239a", ".deps/foo_js_panel"),
    "foo_ui_panels": ("santiagorod92/foo_ui_panels", "37f6149ed92265729f213fae900c93d11965ba46", ".deps/foo_ui_panels"),
}
ASSETS = {
    "foo_js_panel_1.9.0.fb2k-component": ("https://github.com/santiagorod92/foo_js_panel/releases/download/v1.9.0/foo_js_panel_1.9.0.fb2k-component", "2a2f72e6764377c1c3c426a49481d3387c01a3168c25f1cc9b77397df042fb7d"),
    "foo_ui_panels_1.27.0.fb2k-component": ("https://github.com/santiagorod92/foo_ui_panels/releases/download/v1.27.0/foo_ui_panels_1.27.0.fb2k-component", "54e937a8374379641157310ca2dba83a8222996606c2ddc3f3404ba3f6656a40"),
    "remixicon.ttf": ("https://raw.githubusercontent.com/Remix-Design/RemixIcon/v4.9.1/fonts/remixicon.ttf", "cdff268662c834fbe023a8d34f77e2842c50025b093bc827c9b71adefc81b256"),
    "remixicon-LICENSE": ("https://raw.githubusercontent.com/Remix-Design/RemixIcon/v4.9.1/License", "6f2f21c5f8db34635d31848e9ff831d5dc421bb83ffc9d37f82651364047ae58"),
    "fontawesome-webfont.ttf": ("https://raw.githubusercontent.com/FortAwesome/Font-Awesome/v4.7.0/fonts/fontawesome-webfont.ttf", "aa58f33f239a0fb02f5c7a6c45c043d7a9ac9a093335806694ecd6d4edc0d6a8"),
    "fontawesome-README.md": ("https://raw.githubusercontent.com/FortAwesome/Font-Awesome/v4.7.0/README.md", "610427fe917f2b51ef69b5bfa9a7bfe3fcba59b1ccaf86a500a47e5fa1da322b"),
    "fontawesome-OFL-1.1.txt": ("https://raw.githubusercontent.com/spdx/license-list-data/v3.27.0/text/OFL-1.1.txt", "8eea8287e5876b539670cadb82e99f9a7afddec6f6730811be1daf25d2e9bcfd"),
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dump(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def files(directory: Path):
    return sorted(p for p in directory.rglob("*") if p.is_file() and ".git" not in p.parts and "__pycache__" not in p.parts)


def asset_path(name: str) -> Path:
    """发行包内 source/ 可直接复用随包资源，离线重建不必重新下载。"""
    local = ROOT / ".deps/releases" / name
    if local.exists():
        return local
    bundle = ROOT.parent
    if (bundle / "manifest.json").is_file():
        if name.endswith(".fb2k-component"):
            return bundle / "components" / name
        if name.endswith(".ttf"):
            return bundle / "profile/foo_js_panel/fonts" / ("foobox-" + name)
        return bundle / "licenses" / name
    return local


def fetch() -> None:
    for repo, revision, dest in PINS.values():
        path = ROOT / dest
        if path.exists():
            if not (path / ".git").exists():
                if dest.startswith("upstream/"):
                    verify_upstream(path)
                    continue
                raise ValueError(f"目录已存在但不是固定依赖仓库：{path}")
            actual = subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()
            if actual != revision:
                raise ValueError(f"依赖版本不符，保留原目录：{path} ({actual})")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(["git", "init", str(path)], check=True, capture_output=True)
            subprocess.run(["git", "-C", str(path), "remote", "add", "origin", f"https://github.com/{repo}.git"], check=True)
            subprocess.run(["git", "-C", str(path), "fetch", "--depth", "1", "origin", revision], check=True)
            subprocess.run(["git", "-C", str(path), "checkout", "--detach", "FETCH_HEAD"], check=True)
    asset_dir = ROOT / ".deps/releases"
    asset_dir.mkdir(parents=True, exist_ok=True)
    for name, (url, expected) in ASSETS.items():
        path = asset_dir / name
        if not path.exists():
            print(f"下载 {name}", flush=True)
            with urllib.request.urlopen(url, timeout=90) as response:
                data = response.read()
            if hashlib.sha256(data).hexdigest() != expected:
                raise ValueError(f"下载校验失败：{name}")
            path.write_bytes(data)
        if digest(path) != expected:
            raise ValueError(f"资源校验失败：{path}")
    print("固定依赖与资源校验通过")


def verify_upstream(source: Path) -> None:
    lock = json.loads((ROOT / "upstream.lock.json").read_text())
    for rel, expected in lock["files"].items():
        p = source / rel
        if not p.is_file() or digest(p) != expected:
            raise ValueError(f"上游文件变化，停止应用补丁：{rel}")
    actual = {p.relative_to(source).as_posix() for p in files(source / "script")}
    wanted = {p for p in lock["files"] if p.startswith("script/")}
    if actual != wanted:
        raise ValueError("上游脚本/资源集合变化，请先更新锁文件和补丁")


def replace_once(text: str, old: str, new: str, name: str) -> str:
    if text.count(old) != 1:
        raise ValueError(f"补丁锚点不匹配：{name}，期望1处，实际{text.count(old)}处")
    return text.replace(old, new, 1)


def transform(rel: str, text: str) -> str:
    text = text.replace("foobox\\\\", "foobox-macos/")
    text = text.replace("images\\\\genre", "images\\\\Genre")
    # 汉化版菜单路径不能用于英文 macOS 宿主；面板显示文案仍保持中文。
    commands = {
        "打开...": "File/Open...", "文件/新建播放列表": "File/New playlist",
        "文件/载入播放列表...": "File/Load playlist...", "文件/保存所有播放列表...": "File/Save all playlists...",
        "文件/保存播放列表...": "File/Save playlist...", "文件/参数选项": "File/Preferences",
        "文件/退出": "File/Exit", "编辑/全选": "Edit/Select all", "编辑/清除": "Edit/Clear",
        "编辑/移除重复项": "Edit/Remove duplicates", "编辑/移除无效项": "Edit/Remove dead items",
        "编辑/排序/反向": "Edit/Sort/Reverse", "媒体库/专辑列表": "Library/Album List",
        "媒体库/分面查看器": "Library/Album List", "视图/播放列表管理器": "View/Playlist Manager",
        "激活正在播放项目": "View/Show now playing",
    }
    for before, after in commands.items():
        text = text.replace(f'fb.RunMainMenuCommand("{before}")', f'fb.RunMainMenuCommand("{after}")')
    for before, after in {"添加到播放队列": "Add to playback queue", "播放": "Play", "属性": "Properties", "批量内嵌图像": "Tagging/Attach pictures", "移除所有图像": "Tagging/Remove all pictures"}.items():
        text = text.replace(f'fb.RunContextCommandWithMetadb("{before}",', f'fb.RunContextCommandWithMetadb("{after}",')
    if rel == "js_common/getconfig.js":
        text = replace_once(text, "window.DrawMode = 1;", "window.DrawMode = 0;", rel)
        for line in [
            "if (cfg_map.winFrame != fb.Window.FrameStyle) fb.Window.FrameStyle = cfg_map.winFrame;",
            "if (!fb.Window.MainMenuHidden) fb.Window.MainMenuHidden = true;",
            "if (!fb.Window.StatusBarHidden) fb.Window.StatusBarHidden = true;",
        ]:
            text = replace_once(text, line, "", rel)
        text += "\n// Mac 使用系统标题栏；绘制后端由 JS Panel 管理。\ncfg_map.winFrame = 0;\n"
    elif rel == "js_panels/base.js":
        text = replace_once(text, "g_font = window.GetFontDUI(FontTypeDUI.playlists);", "g_font = gdi.Font(window.GetFontDUI(FontTypeDUI.playlists).Name, 12, 0); // 控制条使用固定逻辑尺寸；整体缩放交由 Panels UI。", rel)
        text = replace_once(text, "minh = z(250);", "minh = 1;", rel)
        text = replace_once(text,
            "gb.FillGradRectV2(0, z8, 100, z4, 0, [0, colors_seek[0], 0.5, colors_seek[1], 1.0, colors_seek[2]]);",
            "gb.FillGradRect(0, z8, 50, z4, 0, colors_seek[0], colors_seek[1]);\n\t\tgb.FillGradRect(50, z8, 50, z4, 0, colors_seek[1], colors_seek[2]);", rel)
        text = replace_once(text, "\tthis.switch_panel = function(id) {", "\tthis.switch_panel = function(id) { macSwitch(id); return;\n", rel)
        text = replace_once(text, "on_init();", "include(fb.ProfilePath + 'foobox-macos/controls.js');\non_init();", rel)
        text += "\ninclude(fb.ProfilePath + 'foobox-macos/controls-after.js');\n"
    elif rel == "js_panels/infoArt.js":
        text = replace_once(text, "try { ESL = window.GetPanel('ESLyric'); } catch (e) {}", "// 歌词由 Panels UI 的 Lyric Show 面板提供。", rel)
        text = replace_once(text, "GetColourSchemeJSONV2(cfg_map.color_threshold)", "GetColourSchemeJSON(cfg_map.color_threshold)", rel)
    elif rel == "js_panels/jsplaylist/WSHplaylist.js":
        for menu_id, label in ((7000, "标签繁转简"), (7001, "标签简转繁")):
            text = replace_once(text, f'_child01.AppendMenuItem(MF_STRING, {menu_id}, "{label}");',
                f'_child01.AppendMenuItem(MF_GRAYED, {menu_id}, "{label}");', rel)
    elif rel == "js_panels/jsplaylist/WSHsettings.js":
        start = text.index("\t\tcase 17:")
        end = text.index("\n\t\t}\n\t\tbreak;", start)
        text = text[:start] + "\t\tcase 17:\n\t\t\tcfg_map.winFrame = 0; // 保持原生 Mac 窗口框架\n\t\t\tp.settings.pages[parentId].elements[id].repaint();\n\t\t\tbreak;" + text[end:]
    elif rel == "js_panels/jsspm.js":
        text = replace_once(text, "var PLRecManager = plman.PlaylistRecycler;", "var PLRecManager = { Count: 0 }; // SMP 宿主未公开列表回收站，禁用对应菜单。", rel)
    elif rel == "js_panels/jsview_playlist.js":
        text = replace_once(text, 'var leftratio = window.GetProperty("LeftPane.Ratio", 0.7825);', "var leftratio = 0;", rel)
        start = text.index("function get_panel(){")
        end = text.index("//=================================================// Custom functions", start)
        text = text[:start] + "function get_panel() { pcb = true; }\nfunction set_panel(pw) {}\n" + text[end:]
        text = text.replace("rx = Math.round((ww-2)*leftratio) + 2;", "rx = 0;")
        text = replace_once(text, "if(x < rx + 2) {", "if(false) { // 平铺布局没有嵌套分隔条\n", rel)
    if rel == "js_panels/jssb.js":
        text = replace_once(text, 'var CACHE_FOLDER = fb.ProfilePath + "foobox-macos/data\\\\albumart_cache";',
                            "var CACHE_FOLDER = fb.ProfilePath + 'foobox-macos/data/albumart_cache_hidpi_v1_' + fooboxHiDPI.density();", rel)
        text = replace_once(text, "(img.Width * img.Height * 4)", "fooboxHiDPI.bytes(img)", rel)
    elif rel == "js_panels/jsplaylist.js":
        text = replace_once(text, 'var cover_cache_folder = fb.ProfilePath + "foobox-macos/data\\\\albumart_cache\\\\";',
                            "var cover_cache_folder = fb.ProfilePath + 'foobox-macos/data/albumart_cache_hidpi_v1_' + fooboxHiDPI.density() + '/';", rel)
    return text


def build(output: Path | None = None) -> Path:
    source = ROOT / "upstream/foobox-cn"
    verify_upstream(source)
    output = output or ROOT / "build/foobox-macos"
    if output.exists():
        # 只清理构建专用目录，绝不把 install 的 profile 当作构建输出。
        if output.resolve() != (ROOT / "build/foobox-macos").resolve():
            raise ValueError("自定义输出已存在，拒绝覆盖")
        shutil.rmtree(output)
    profile = output / "profile"
    target = profile / "foobox-macos"
    for path in files(source / "script"):
        rel = path.relative_to(source / "script").as_posix()
        dest = target / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if path.suffix == ".js":
            dest.write_text(transform(rel, path.read_text(encoding="utf-8-sig")), encoding="utf-8")
        else:
            shutil.copy2(path, dest)
    for path in files(ROOT / "macos"):
        shutil.copy2(path, target / path.relative_to(ROOT / "macos"))
    skin = profile / "foo_ui_panels/foobox-macos"
    shutil.copytree(ROOT / "skin", skin)
    entries = {"Controls": "base", "Playlist": "jsplaylist", "Manager": "jsspm", "Browser": "jssb", "BrowserList": "jsview_playlist", "Info": "infoArt"}
    for name, script in entries.items():
        path = skin / "js" / (name + ".js")
        path.parent.mkdir(parents=True, exist_ok=True)
        text = "include(fb.ProfilePath + 'foobox-macos/host.js');\ninclude(fb.ProfilePath + 'foobox-macos/hidpi.js');\ninclude(fb.ProfilePath + 'foobox-macos/js_panels/" + script + ".js');\n"
        if name == "Playlist":
            text += "if (typeof panelsui !== 'undefined' && panelsui.IsAvailable) on_notify_data('foobox_setting', panelsui.GetVariable('foobox.view', 'playlist') === 'settings' ? 1 : 0);\n"
        text += "fooboxHiDPI.install();\n"
        path.write_text(text, encoding="utf-8")
    (output / "licenses").mkdir(parents=True)
    shutil.copy2(source / "LICENSE", output / "LICENSE")
    for name, (_, expected) in ASSETS.items():
        asset = asset_path(name)
        if not asset.is_file() or digest(asset) != expected:
            raise ValueError(f"缺少固定资源或摘要不符：{name}；请运行 fetch")
        if name.endswith(".fb2k-component"):
            dest = output / "components" / name
        elif name.endswith(".ttf"):
            dest = profile / "foo_js_panel/fonts" / ("foobox-" + name)
        else:
            dest = output / "licenses" / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(asset, dest)
    for name in ("foo_js_panel", "foo_ui_panels"):
        license_file = ROOT / ".deps" / name / "LICENSE"
        if not license_file.exists():
            license_file = ROOT.parent / "licenses" / (name + "-MIT.txt")
        shutil.copy2(license_file, output / "licenses" / (name + "-MIT.txt"))
    shutil.copy2(ROOT / "README.md", output / "README.md")
    shutil.copy2(ROOT / "README.zh-CN.md", output / "README.zh-CN.md")
    shutil.copy2(ROOT / "THIRD_PARTY.md", output / "THIRD_PARTY.md")
    # 安装器独立运行；源码一并交付以满足 GPL 并可重建。
    src = output / "source"
    for directory in ("macos", "skin", "tools", "tests"):
        shutil.copytree(ROOT / directory, src / directory, ignore=shutil.ignore_patterns("__pycache__"))
    for name in ("README.md", "README.zh-CN.md", "THIRD_PARTY.md", "LICENSE", "upstream.lock.json"):
        shutil.copy2(ROOT / name, src / name)
    shutil.copytree(source / "script", src / "upstream/foobox-cn/script")
    for name in ("README.md", "LICENSE"):
        shutil.copy2(source / name, src / "upstream/foobox-cn" / name)
    manifest = {
        "version": VERSION, "upstream_revision": REVISION,
        "profile_files": {p.relative_to(profile).as_posix(): digest(p) for p in files(profile)},
        "assets": {name: {"url": url, "sha256": sha} for name, (url, sha) in ASSETS.items()},
        "verification": "真实 JS Panel 离线引擎验证；播放器内功能见 README 的待验证项",
    }
    dump(output / "manifest.json", manifest)
    print(f"构建完成：{output}")
    return output


def package() -> Path:
    output = build()
    archive = ROOT / "dist" / f"foobox-macos-{VERSION}.zip"
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for path in files(output):
            info = zipfile.ZipInfo(f"foobox-macos-{VERSION}/" + path.relative_to(output).as_posix(), (2026, 11, 17, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, path.read_bytes())
    archive.with_suffix(".zip.sha256").write_text(digest(archive) + "  " + archive.name + "\n")
    print(f"安装包：{archive}")
    return archive


def safe_target(root: Path, rel: str) -> Path:
    p = PurePosixPath(rel)
    if p.is_absolute() or ".." in p.parts or "\\" in rel or not p.parts:
        raise ValueError(f"非法相对路径：{rel}")
    target = root / rel
    for parent in (target, *target.parents):
        if parent == root.parent:
            break
        if parent.is_symlink():
            raise ValueError(f"目标含符号链接，未写入：{parent}")
    return target


def install(bundle: Path, profile: Path) -> Path:
    bundle, profile = bundle.resolve(), profile.expanduser().absolute()
    manifest = json.loads((bundle / "manifest.json").read_text())
    entries = manifest["profile_files"]
    if not entries:
        raise ValueError("安装清单为空")
    for name, item in manifest.get("assets", {}).items():
        if name.endswith(".fb2k-component"):
            component = bundle / "components" / name
            if not component.is_file() or digest(component) != item["sha256"]:
                raise ValueError(f"组件缺失或校验失败：{name}；请重新解压完整安装包")
    for rel, expected in entries.items():
        check_install_path(rel)
        source = safe_target(bundle / "profile", rel)
        if not source.is_file() or digest(source) != expected:
            raise ValueError(f"安装文件校验失败：{rel}")
        target = safe_target(profile, rel)
        if target.exists() and not target.is_file():
            raise ValueError(f"目标不是普通文件：{target}")
    backup = profile / ".foobox-macos-backups" / str(time.time_ns())
    safe_target(profile, backup.relative_to(profile).as_posix())
    backup.mkdir(parents=True)
    state = {"profile": str(profile), "entries": {}, "version": VERSION}
    for rel in entries:
        target = profile / rel
        state["entries"][rel] = target.exists()
        if target.exists():
            dest = backup / "files" / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, dest)
    dump(backup / "state.json", state)
    changed = []
    try:
        for rel in entries:
            target = profile / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            changed.append(rel)
            # 先记录将更改的目标，复制中途失败也恢复它；原子替换避免半截脚本。
            atomic_copy(bundle / "profile" / rel, target)
    except Exception:
        for rel in reversed(changed):
            if state["entries"][rel]:
                shutil.copy2(backup / "files" / rel, profile / rel)
            else:
                (profile / rel).unlink(missing_ok=True)
        (backup / "restored").write_text("安装失败，已自动恢复\n")
        raise
    print(f"主题安装完成：{profile / 'foo_ui_panels/foobox-macos'}")
    print(f"回滚备份：{backup}")
    print("请在 foobar2000 中安装 components 下的两个组件，再选择 Panels UI 和上述主题目录。")
    return backup


def rollback(profile: Path, backup: Path | None = None) -> None:
    profile = profile.expanduser().absolute()
    backups = profile / ".foobox-macos-backups"
    if backup is None:
        candidates = sorted(p for p in backups.glob("*/state.json") if not (p.parent / "restored").exists())
        if not candidates:
            raise ValueError("没有可回滚的安装")
        backup = candidates[-1].parent
    backup = backup.absolute()
    if backup.parent != backups:
        raise ValueError("备份不属于目标 profile")
    safe_target(profile, backup.relative_to(profile).as_posix())
    if (backup / "restored").exists():
        raise ValueError("此安装已经回滚，拒绝重复恢复")
    pending = sorted(p.parent for p in backups.glob("*/state.json") if not (p.parent / "restored").exists())
    if not pending or backup != pending[-1]:
        raise ValueError("请先回滚最近一次安装，避免旧备份覆盖更新版本")
    state = json.loads((backup / "state.json").read_text())
    if state["profile"] != str(profile):
        raise ValueError("备份 profile 不匹配")
    for rel, existed in state["entries"].items():
        check_install_path(rel)
        safe_target(profile, rel)
        if existed and not safe_target(backup / "files", rel).is_file():
            raise ValueError(f"备份文件缺失：{rel}")
    # 回滚前暂存当前版本，操作失败则恢复，避免混合版本。
    with tempfile.TemporaryDirectory(prefix="foobox-rollback-", dir=backups) as temp:
        current = Path(temp)
        present = {}
        for rel in state["entries"]:
            path = profile / rel
            present[rel] = path.exists()
            if path.exists():
                dest = current / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, dest)
        changed = []
        try:
            for rel, existed in state["entries"].items():
                dest = profile / rel
                changed.append(rel)
                if existed:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    atomic_copy(backup / "files" / rel, dest)
                else:
                    dest.unlink(missing_ok=True)
        except Exception:
            for rel in reversed(changed):
                if present[rel]:
                    atomic_copy(current / rel, profile / rel)
                else:
                    (profile / rel).unlink(missing_ok=True)
            raise
    (backup / "restored").write_text("已回滚\n")
    print("已恢复安装前的文件；运行后生成的设置、缓存与音乐库保留。")


def atomic_copy(source: Path, target: Path) -> None:
    fd, name = tempfile.mkstemp(prefix=".foobox-copy-", dir=target.parent)
    import os
    os.close(fd)
    temp = Path(name)
    try:
        shutil.copy2(source, temp)
        temp.replace(target)
    finally:
        temp.unlink(missing_ok=True)


def check_install_path(rel: str) -> None:
    if not (rel.startswith("foobox-macos/") or rel.startswith("foo_ui_panels/foobox-macos/") or rel.startswith("foo_js_panel/fonts/foobox-")):
        raise ValueError(f"文件不属于主题安装目录：{rel}")
    if rel.startswith("foobox-macos/data/"):
        raise ValueError(f"安装包不得覆盖用户设置：{rel}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("fetch", "build", "package"):
        sub.add_parser(command)
    for command in ("install", "rollback"):
        p = sub.add_parser(command)
        p.add_argument("--profile", type=Path, default=Path.home() / "Library/foobar2000-v2")
        if command == "install":
            p.add_argument("--bundle", type=Path, default=ROOT.parent if (ROOT.parent / "manifest.json").exists() else ROOT / "build/foobox-macos")
        else:
            p.add_argument("--backup", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "fetch": fetch()
        elif args.command == "build": build()
        elif args.command == "package": package()
        elif args.command == "install": install(args.bundle, args.profile)
        else: rollback(args.profile, args.backup)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"错误：{error}\n")


if __name__ == "__main__":
    main()

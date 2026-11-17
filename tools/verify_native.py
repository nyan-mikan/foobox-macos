#!/usr/bin/env python3
"""在真实 QuickJS/CoreGraphics 引擎中验证空态、非空曲目与事件，并检查原生布局。"""
import concurrent.futures
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import foobox


def run(args, **kwargs):
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result


def compile_tools():
    jsp, pui = ROOT / ".deps/foo_js_panel", ROOT / ".deps/foo_ui_panels"
    run(["make", "-C", jsp, "build/tools/render_script"])
    run(["make", "-C", pui, "skin-lint"])
    binary = ROOT / "build/native/render_scenario"
    layout = ROOT / "build/native/layout_probe"
    binary.parent.mkdir(parents=True, exist_ok=True)
    runtime = [pui / "src/core" / (n + ".cpp") for n in ("script_runtime", "script_util", "skin_config", "i18n", "i18n_table")]
    includes = ["-I" + str(pui / "src"), "-I" + str(pui / "tests")]
    sources = [ROOT / "tools/native/render_scenario.mm", jsp / "src/core/js_engine.cpp", jsp / "src/core/image_ops.cpp", jsp / "src/core/theme_patches.cpp", pui / "src/platform/mac/mac_canvas.mm", *runtime]
    if not binary.exists() or any(p.stat().st_mtime > binary.stat().st_mtime for p in sources):
        run(["clang++", "-std=c++20", "-O1", "-fobjc-arc", '-DJSP_LODASH_PATH="' + str(jsp / "third_party/lodash/lodash.js") + '"', "-I" + str(jsp / "src"), "-I" + str(jsp / "third_party/quickjs"), *includes, *sources, *sorted((jsp / "build/tools/qjs").glob("*.o")), "-framework", "CoreGraphics", "-framework", "CoreText", "-framework", "ImageIO", "-framework", "CoreFoundation", "-framework", "Foundation", "-o", binary])
    layout_sources = [ROOT / "tools/native/layout_probe.cpp", *runtime]
    if not layout.exists() or any(p.stat().st_mtime > layout.stat().st_mtime for p in layout_sources):
        run(["clang++", "-std=c++20", "-O1", *includes, *layout_sources, "-o", layout])
    return binary, layout


def verify():
    foobox.build()
    binary, layout = compile_tools()
    out = ROOT / "build/verification"
    out.mkdir(parents=True, exist_ok=True)
    profile_source = ROOT / "build/foobox-macos/profile"
    stock = ROOT / ".deps/foo_js_panel/build/tools/render_script"
    names = ["Controls", "Playlist", "Manager", "Browser", "BrowserList", "Info"]

    def check(item):
        name, mode = item
        with tempfile.TemporaryDirectory(prefix=name + "-", dir=out) as temp:
            profile = Path(temp) / "profile"
            shutil.copytree(profile_source, profile)
            size = "1200x112" if name == "Controls" else "300x600" if name in ("Manager", "Info", "BrowserList") else "900x600"
            args = [stock if mode == "empty" else binary, profile / f"foo_ui_panels/foobox-macos/js/{name}.js", out / f"{name}-{mode}.png", "--profile", profile, "--sandbox", profile, "--size", size, "--rounds", "30"]
            if mode != "empty":
                args += ["--playing", "--new-track", "--library", ROOT / "tools/native/library.tsv", "--art", ROOT / "upstream/foobox-cn/script/images/cover_default.jpg", "--exercise"]
            if mode.startswith("settings-"):
                args += ["--settings-page", mode.split("-")[1]]
            if mode.startswith("navigation"):
                args += ["--navigation"]
                if mode == "navigation-large-font": args += ["--font-size", "18"]
            result = subprocess.run([str(a) for a in args], capture_output=True, text=True, timeout=45)
            (out / f"{name}-{mode}.log").write_text(result.stdout + result.stderr)
            ok = result.returncode == 0 and "not implemented:" not in result.stderr and "script error:" not in result.stderr
            print(f"{'通过' if ok else '失败'}：{name} / {mode}", flush=True)
            return {"panel": name, "state": mode, "passed": ok, "returncode": result.returncode}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        scenarios = [(n, m) for n in names for m in ("empty", "playing")]
        scenarios += [("Playlist", f"settings-{page}") for page in range(5)]
        scenarios += [("Controls", "navigation"), ("Controls", "navigation-large-font")]
        checks = list(pool.map(check, scenarios))
    hidpi = []
    for zoom in (100, 125, 150, 175, 200, 300, 400):
        with tempfile.TemporaryDirectory(prefix="hidpi-", dir=out) as temp:
            profile = Path(temp) / "profile"
            shutil.copytree(profile_source, profile)
            result = run([binary, ROOT / "tests/hidpi_native.js", out / f"hidpi-{zoom}.png", "--profile", profile,
                          "--sandbox", profile, "--size", "320x80", "--scale", str(2 * zoom / 100), "--zoom", str(zoom), "--verify-hidpi"])
            (out / f"hidpi-{zoom}.log").write_text(result.stdout + result.stderr)
            # 六面板以与 Retina × zoom 相同的物理像素比例实际绘制。
            for name in names:
                args = [binary, profile / f"foo_ui_panels/foobox-macos/js/{name}.js", out / f"{name}-zoom-{zoom}.png",
                        "--profile", profile, "--sandbox", profile, "--size", "1200x112" if name == "Controls" else "600x450",
                        "--scale", str(2 * zoom / 100), "--zoom", str(zoom), "--rounds", "5", "--playing"]
                result = run(args, timeout=60)
                if "not implemented:" in result.stderr or "script error:" in result.stderr:
                    raise RuntimeError(result.stderr)
            hidpi.append({"zoom": zoom, "retina_scale": 2 * zoom / 100, "panels": names, "passed": True})
            print(f"通过：高分屏缩放 {zoom}% / 六面板及位图操作", flush=True)
    with tempfile.TemporaryDirectory(prefix="hidpi-live-", dir=out) as temp:
        profile = Path(temp) / "profile"
        shutil.copytree(profile_source, profile)
        result = run([binary, ROOT / "tests/hidpi_native.js", out / "hidpi-live-100-to-200.png", "--profile", profile,
                      "--sandbox", profile, "--size", "320x80", "--scale", "4", "--zoom", "100", "--zoom-after", "200", "--verify-hidpi"])
        (out / "hidpi-live-100-to-200.log").write_text(result.stdout + result.stderr)
        hidpi.append({"zoom_transition": [100, 200], "passed": True})
    lint = run([ROOT / ".deps/foo_ui_panels/build/tools/skin_lint", profile_source / "foo_ui_panels/foobox-macos"])
    (out / "skin-lint.log").write_text(lint.stdout + lint.stderr)
    placements = []
    for width, height in ((1200, 800), (800, 600), (500, 400), (200, 80)):
        for view in ("playlist", "browser", "lyrics", "spectrum", "settings"):
            result = run([layout, ROOT / "skin/main.txt", str(width), str(height), "foobox.view=" + view])
            panels = []
            for line in result.stdout.splitlines():
                name, kind, x, y, w, h = line.split("\t")
                x, y, w, h = map(int, (x, y, w, h))
                if min(x, y) < 0 or min(w, h) <= 0 or x + w > width or y + h > height:
                    raise RuntimeError(f"面板超出窗口：{width}x{height} {view} {line}")
                panels.append({"name": name, "type": kind, "rect": [x, y, w, h]})
            expected = {"Controls": "JS Panel"}
            if view == "browser":
                expected.update(Browser="JS Panel", BrowserList="JS Panel")
            elif view == "lyrics":
                expected.update(Info="JS Panel", Lyrics="Lyric Show")
            elif view == "spectrum":
                expected.update(Spectrum="Spectrum")
            else:
                expected.update(Playlist="JS Panel")
                if width > 499: expected.update(Manager="JS Panel")
                if width > 899: expected.update(Info="JS Panel")
            actual = {p["name"]: p["type"] for p in panels}
            if actual != expected:
                raise RuntimeError(f"视图面板缺失或类型错误：{view}，期望{expected}，得到{actual}")
            for a in panels:
                for b in panels:
                    if a is b: continue
                    ax, ay, aw, ah = a["rect"]; bx, by, bw, bh = b["rect"]
                    if max(ax, bx) < min(ax + aw, bx + bw) and max(ay, by) < min(ay + ah, by + bh):
                        raise RuntimeError(f"面板重叠：{view} {a} {b}")
            placements.append({"size": [width, height], "view": view, "panels": panels})
    report = {"script_checks": checks, "hidpi_checks": hidpi, "layout_scenarios": placements, "limitations": "离线真实引擎；曲目与titleformat为测试宿主，歌词/FFT/音频/拖放/窗口焦点尚未在播放器验收"}
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if not all(c["passed"] for c in checks):
        raise RuntimeError("存在脚本错误或缺失接口，请检查 build/verification/*.log")
    print(f"通过 {len(checks)} 个脚本场景、{len(placements)} 个布局场景；报告：{out / 'report.json'}")


if __name__ == "__main__":
    try:
        verify()
    except (RuntimeError, OSError) as error:
        sys.exit(str(error))

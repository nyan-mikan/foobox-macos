# foobox macOS

English | [简体中文](README.zh-CN.md)

A native macOS adaptation of [dream7180/foobox-cn](https://github.com/dream7180/foobox-cn) for foobar2000. It reuses the original playlist, playlist manager, search, cover browser, artwork information, settings, and playback-control scripts through [JS Panel](https://github.com/santiagorod92/foo_js_panel). [Panels UI (reborn)](https://github.com/santiagorod92/foo_ui_panels) provides the layout, native lyrics, and spectrum panels.

**Version 0.1.1 — experimental.** The theme runs in the native macOS player. Playback, online services, and large music libraries still need further testing; see [Known limitations](#known-limitations).

This repository is a fork of foobox-cn. The default `macos` branch contains the adaptation; `master` preserves the original Windows theme. The original scripts and assets are fetched at a pinned revision when building.

## Features

- Six adapted script panels: playlist, playlist manager, cover browser, browser list, artwork information, and playback controls.
- Five views: playlist, cover browser, lyrics, spectrum, and settings.
- Native macOS title bar and system menus.
- Retina-aware UI bitmap caches that follow Panels UI Zoom, with logical layout and hit testing kept consistent.
- Cover caches separated by pixel density, with the browser's 96 MiB LRU budget measured in physical pixels.
- A reproducible build, bundled source and licenses, and an installer with backups and rollback.

## Requirements

- macOS 11 or later and native foobar2000 for Mac v2.
- Git and Python 3.9 or later to fetch dependencies and build the installation package.
- The generated package includes JS Panel 1.9.0 and Panels UI 1.27.0 components for Apple Silicon and Intel, plus the required icon fonts.

## Installation

1. Clone this repository and build the package:

   ```sh
   git clone https://github.com/nyan-mikan/foobox-macos.git
   cd foobox-macos
   python3 tools/foobox.py fetch
   python3 tools/foobox.py package
   ```

   Extract `dist/foobox-macos-0.1.1.zip` and open the extracted `foobox-macos-0.1.1` directory. Subsequent commands in this section run from that directory.

2. Quit foobar2000, then install the theme files:

   ```sh
   python3 source/tools/foobox.py install --bundle .
   ```

   The default profile is `~/Library/foobar2000-v2`. Add `--profile '/absolute/path'` for a custom profile. The installer copies theme files and fonts, backs up existing managed files, and preserves generated theme settings and caches. It does not modify the player's configuration database.

3. Open foobar2000. In **Preferences → Components**, install both `.fb2k-component` files from `components/`, then restart. Existing newer component versions do not need to be downgraded.

4. In **Preferences → Display**, select **Panels UI (reborn)** and restart. In the Panels UI settings, select this theme directory:

   ```text
   ~/Library/foobar2000-v2/foo_ui_panels/foobox-macos
   ```

5. Use the control bar to switch views. Add music through foobar2000's media-library settings or drag music files into the player.

Search supports the current playlist and media library. The native lyrics panel supports tags and matching `.lrc` files. Online lyrics search is disabled by default and can be enabled in the lyrics context menu.

## Rollback

Quit foobar2000 and run this from the extracted package directory:

```sh
python3 source/tools/foobox.py rollback
```

Use the same `--profile` argument if you installed to a custom profile. To restore a specific installation backup, add `--backup '/absolute/path/to/backup'`.

Backups live under `.foobox-macos-backups/` in the profile. Rollback restores overwritten files, removes newly installed program files, and preserves data generated after installation. Select another UI or uninstall components through foobar2000's Preferences if needed.

## Building and testing

The foobox-cn source is pinned to `4a2d5e0ed8caea5265a6471d8e41d6ddeffb44c8`. File hashes are recorded in `upstream.lock.json`; the build verifies them before applying patches with checked anchors. Downloaded upstream source is stored in the ignored `upstream/` directory and is not modified.

From the repository root:

```sh
python3 tools/foobox.py fetch
python3 tools/foobox.py build
python3 tools/foobox.py package
node --test tests/test_host.js
python3 -m unittest discover -s tests -p 'test_*.py'
```

Node.js is only needed for the JavaScript regression tests. Build output is written to `build/foobox-macos/`; the ZIP and SHA-256 checksum are written to `dist/`. `fetch` downloads the pinned dependencies, components, and fonts. `build` and `package` use local files without network access.

The package includes original and adapted source under `source/`. From that directory, `python3 tools/foobox.py package` can rebuild the package offline using the bundled components, fonts, and licenses.

Optional native checks require Xcode Command Line Tools and dependency source obtained with `fetch`:

```sh
make -C .deps/foo_js_panel build/tools/render_script
make -C .deps/foo_ui_panels skin-lint
python3 tools/verify_native.py
```

### Validation

- 18 JavaScript regression tests and 13 Python build, installation, rollback, and package tests.
- 19 script scenarios in the real QuickJS/CoreGraphics engine and 20 Panels UI layout scenarios, including five settings pages, view navigation, clicks without a preceding mouse-move event, cross-region seek release, an 18px host font, and layouts from 200×80 to 1200×800.
- All six script panels at 100%, 125%, 150%, 175%, 200%, 300%, and 400% Retina scaling, plus bitmap pixel comparisons for cropping, raw bitmap aliases, and masks. A same-process 100% → 200% transition verifies script reload and cache regeneration.
- Installation, rollback, and offline rebuilding from the extracted package in paths containing spaces and Chinese characters; the rebuilt ZIP has an identical SHA-256 checksum.

Native reports, logs, and PNGs are generated under `build/verification/`.

On 2026-11-17, the theme was smoke-tested with Homebrew-installed foobar2000 2.26.3 on Apple Silicon and macOS 15.7.7. All five views switched successfully, and the 150% display was checked in the player. Audio output and music-dependent behavior have not yet been validated in the player.

## Known limitations

- Panels UI uses a flat layout. The cover browser's right-hand list reuses the original simplified playlist; Windows-style nested splitters are not ported.
- Theme database calls use separate JSON files in `foobox-macos/data/*.db.json`. Windows SQLite files are not imported or modified.
- Workers use an asynchronous queue on the main thread. Initial cover-cache population may cause pauses; large libraries have not been performance-tested.
- JS Panel does not expose stable playlist GUIDs. Virtual grouping uses playlist names and duplicate-name ordinals, so external renaming or reordering identically named playlists may change group associations.
- The deleted-playlist history/restore menu is disabled because the required host API is unavailable.
- Lyrics and spectrum use Panels UI's native implementations. ESLyric provider scripts, skins, and all settings are not ported. Full artwork-color synchronization with native lyrics is incomplete.
- Windows `.exe` helpers, some Simplified/Traditional Chinese conversion commands, and the video panel are not included as Mac features. Biography source is retained in the package, but its UI is not enabled and network fetching has not been validated.
- The supplied layout is dark. Light mode and automatic appearance switching have not received visual validation.
- Playback controls use a fixed 12px logical font; use Panels UI Zoom to scale the full interface. Other panels follow their theme font settings.
- Original low-resolution artwork remains limited by its source resolution. Higher-density UI caches cannot restore missing image detail.
- Audio output, music-file drag and drop, online lyric matching, and spectrum FFT response to music remain unverified in the player. Offline checks do not establish that those features work end to end.

## Credits and license

The original foobox theme is by [dream7180 and contributors](https://github.com/dream7180/foobox-cn). This adaptation preserves upstream history and attribution.

Theme scripts and this project's modifications are distributed under [GPL-3.0](LICENSE). Components and fonts retain their respective licenses. See [THIRD_PARTY.md](THIRD_PARTY.md) for pinned sources and versions, and `manifest.json` and `licenses/` in the generated package for hashes and license texts.

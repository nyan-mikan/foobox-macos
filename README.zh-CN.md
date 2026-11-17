# foobox macOS

[English](README.md) | 简体中文

复用 [foobox-cn](https://github.com/dream7180/foobox-cn) 脚本的 macOS 移植版本，通过 JS Panel 执行原有面板，使用 Panels UI 提供布局、歌词和频谱。保留原版播放列表、管理器、搜索、封面浏览、封面信息、设置与播放控制的主体代码。

当前版本 **0.1.1，供验证使用**。已经提供可构建源码和安装包；验证范围与尚未完成的部分见下文。

## 安装

需要 macOS 11+、原生 macOS foobar2000 v2；安装包包含支持 Intel 和 Apple Silicon 的 JS Panel 1.9.0、Panels UI 1.27.0。请先退出 foobar2000，再安装主题文件。

1. 克隆本仓库并生成安装包（需要 Git 和 Python 3.9+）：

   ```sh
   git clone https://github.com/nyan-mikan/foobox-macos.git
   cd foobox-macos
   python3 tools/foobox.py fetch
   python3 tools/foobox.py package
   ```

   解压生成的 `dist/foobox-macos-0.1.1.zip`，进入解压后的 `foobox-macos-0.1.1` 文件夹。
2. 在终端运行（Python 3.9+）：

   ```sh
   python3 source/tools/foobox.py install --bundle .
   ```

   默认目标为 `~/Library/foobar2000-v2`。自定义 profile 使用 `--profile '/完整路径'`。安装器只复制主题与字体，不改播放器配置数据库；旧文件会备份，已生成的主题设置和缓存会保留。
3. 启动 foobar2000，在 Preferences → Components 中安装 `components/` 下的两个 `.fb2k-component` 文件，重启。已有更新版本时不必降级。
4. 在 Preferences → Display 中选择 **Panels UI (reborn)** 并重启，在其设置中选择主题文件夹：

   ```text
   ~/Library/foobar2000-v2/foo_ui_panels/foobox-macos
   ```

5. 在控制条上切换播放列表、封面浏览器、歌词、频谱和设置。首次使用请通过 foobar2000 自带设置添加媒体库，或拖入音乐文件。

使用 Mac 原生标题栏和系统菜单。搜索支持当前列表/媒体库；歌词使用标签、同名 `.lrc` 文件和原生歌词面板的搜索能力，在线搜索默认关闭，可在歌词右键菜单开启。

## 回滚

退出 foobar2000，在解压文件夹运行：

```sh
python3 source/tools/foobox.py rollback
```

自定义 profile 安装后，回滚也须传相同的 `--profile`。可用 `--backup '/备份完整路径'` 指定某次安装的备份。备份保存在 profile 下的 `.foobox-macos-backups/`。回滚恢复被覆盖的文件、移除本次新增的程序文件，保留安装后生成的数据；播放器界面模块和组件由用户在 Preferences 中切换/卸载。

## 从源码重建

上游固定于 `4a2d5e0ed8caea5265a6471d8e41d6ddeffb44c8`；所有上游脚本与资源的摘要存于 `upstream.lock.json`。构建先验证摘要，再应用带锚点检查的补丁；不会改写 `upstream/`。

```sh
python3 tools/foobox.py fetch
python3 tools/foobox.py build
python3 tools/foobox.py package
node --test tests/test_host.js
python3 -m unittest discover -s tests -p 'test_*.py'
```

构建结果位于 `build/foobox-macos/`，压缩包与 SHA-256 位于 `dist/`。`fetch` 下载固定依赖并校验组件和字体；`build`、`package` 使用本地文件，不联网。安装包中的 `source/` 包含原始脚本、修改脚本和构建工具；进入该目录可直接离线运行 `python3 tools/foobox.py package`，复用随包组件、字体与许可重建。原生检查工具仍需先运行 `fetch` 获取源码依赖。

可选原生离线检查需要 Xcode Command Line Tools：

```sh
make -C .deps/foo_js_panel build/tools/render_script
make -C .deps/foo_ui_panels skin-lint
python3 tools/verify_native.py
```

高分屏适配：按钮、滚动条等离屏缓存至少按 Retina 2 倍像素生成，并随 Panels UI Zoom 增加密度；缩放变化时自动重建缓存。封面磁盘缓存按密度分开保存，旧缓存保留；浏览器 LRU 按物理像素计量，维持原有 96 MiB 预算。逻辑尺寸、字体测量与鼠标区域保持一致。原始图片本身分辨率不足时仍受源图清晰度限制。

当前验证结果：18 项 JavaScript 回归测试、13 项 Python 构建/安装/回滚及发行包测试通过；真实 QuickJS/CoreGraphics 引擎通过 19 个脚本场景及 100%、125%、150%、175%、200%、300%、400% 七档 Retina 缩放下的六面板和位图操作专项检查（含裁剪、raw bitmap、遮罩像素比较），以及同进程从 100% 切到 200% 后的缓存重建，Panels UI 布局通过 20 个场景。场景包含五个设置页、实际构建入口的五视图点击、没有预先鼠标移动的点击、进度条跨区域松手、18px 宿主字体，以及 200×80 到 1200×800 的布局。发行包在中文/空格路径独立安装、回滚和离线重建通过，重建 ZIP 的 SHA-256 一致。原生检查报告和 PNG 位于 `build/verification/`。

2026-11-17 在 Homebrew 安装的 foobar2000 2.26.3、Apple Silicon、macOS 15.7.7 上完成组件安装与界面检查，确认播放列表、封面浏览、歌词、频谱和设置五个页面可实际切换，并检查了 150% 缩放画面。修复了原生点击没有先投递 `mouse move` 时按钮无法响应的问题。

## 适配边界与已知限制

- 六个主要面板使用原版脚本；布局由 Panels UI 平铺声明。封面浏览右侧仍复用原版简易列表，Windows 的嵌套分隔条被移除。
- 数据库接口转换为独立 JSON 文件，保存在 `foobox-macos/data/*.db.json`；不读取/修改 Windows SQLite 数据。现有主题设置在更新时保留。
- Worker 使用异步消息队列在主线程执行，保持原消息协议。大量封面首次建立缓存时可能卡顿；未做大媒体库性能验收。
- JS Panel 暂未提供稳定播放列表 GUID。虚拟分组使用列表名称及同名序号作为身份；外部重命名、同名列表重排后，分组关联可能改变。
- 删除播放列表后的“列表记录”恢复菜单暂不可用，已禁用；播放器自身的数据恢复能力不受主题控制。
- 歌词与频谱使用 Panels UI 自带实现，未移植 ESLyric 的来源脚本、皮肤和全部配置。歌词颜色默认与主题一致，封面取色与原生歌词的完整同步尚未完成。
- Windows 外部 `.exe` 工具、部分简繁转换、视频面板不作为 Mac 功能交付。简介源文件保留在包中，但此版本没有启用简介入口，网络抓取尚未验收。
- 当前以深色布局交付；原版部分主题设置仍保留，亮色与系统自动切换没有完成视觉验收。
- 播放控制条固定使用 12px 逻辑字体，整体放大请使用 Panels UI 的 Zoom；其余面板字体按主题设置。
- 已在真实 foobar2000 中确认主题加载和五视图切换。当前音乐列表为空；音频输出、音乐文件拖放、在线歌词匹配和频谱 FFT 随音乐响应仍未验收。离线通过不代表这些功能已经验收。

## 来源与许可

本仓库是 [dream7180/foobox-cn](https://github.com/dream7180/foobox-cn) 的 fork，`macos` 为默认分支，`master` 保留原版 Windows 主题。macOS 构建从固定上游版本提取脚本；运行 `fetch` 获取的源码位于不纳入版本控制的 `upstream/`。

主题脚本及本项目修改按 GPL-3.0 分发，见 `LICENSE`。组件和字体分别遵循各自许可；完整来源、固定版本和摘要见 `THIRD_PARTY.md`、安装包中的 `manifest.json` 与 `licenses/`。

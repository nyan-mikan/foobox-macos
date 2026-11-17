# 第三方来源

| 项目 | 固定版本 | 许可与用途 |
|---|---|---|
| [foobox-cn](https://github.com/dream7180/foobox-cn) | `4a2d5e0ed8caea5265a6471d8e41d6ddeffb44c8` | GPL-3.0；原版脚本、图片与本项目修改 |
| [JS Panel](https://github.com/santiagorod92/foo_js_panel) | 1.9.0，`6ac0a6450917f962098517536b5e40bd47ef239a` | MIT；脚本执行宿主与离线渲染器 |
| [Panels UI](https://github.com/santiagorod92/foo_ui_panels) | 发行包1.27.0，`5ea065692af068c10f387c9331986271fab2a3ae` | MIT；布局、原生歌词和频谱 |
| Panels UI 检查工具源码 | `37f6149ed92265729f213fae900c93d11965ba46` | MIT；本地已固定的兼容接口及离线检查工具，独立于发行包版本记录 |
| [Remix Icon](https://github.com/Remix-Design/RemixIcon/tree/v4.9.1) | 4.9.1 | Remix Icon License v1.0；原版按钮图标字体 |
| [Font Awesome](https://github.com/FortAwesome/Font-Awesome/tree/v4.7.0) | 4.7.0 | 字体 SIL OFL 1.1；封面面板星标等图标 |

安装包保留相关许可与源文件。`tools/native/render_scenario.mm` 改编自 JS Panel 的 MIT 许可 `tools/render_script.mm`，`layout_probe.cpp` 复用 Panels UI 的测试接口；相应 MIT 许可保存在 `licenses/`。组件作为独立 `.fb2k-component` 文件提供，未修改二进制。字体仅通过 JS Panel 的进程内字体目录加载，不安装到系统。依赖内嵌库的归属与许可由其原项目提供。

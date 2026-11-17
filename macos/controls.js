// 原版 base.js 的 Mac 布局钩子；函数在上游 on_init 前由严格补丁加载。
var macViews = ['playlist', 'browser', 'lyrics', 'spectrum', 'settings'];
function macView() {
    var view = typeof panelsui !== 'undefined' && panelsui.IsAvailable ? panelsui.GetVariable('foobox.view', 'playlist') : 'playlist';
    return macViews.indexOf(view) >= 0 ? view : 'playlist';
}
function macSwitch(id) {
    if (!Number.isInteger(id) || id < 1 || id > macViews.length) return;
    var view = macViews[id - 1];
    active_pid = id - 1;
    if (typeof panelsui !== 'undefined' && panelsui.IsAvailable) panelsui.SetVariable('foobox.view', view);
    window.NotifyOthers('foobox_setting', view === 'settings' ? 1 : 0);
    window.Repaint();
}
function get_panel() {
    panel.ico = ['\uF011', '\uF158', '\uF2D5', '\uF3A8', '\uF0E4'];
    panel.tip = ['播放列表', '封面浏览器', '歌词', '频谱', '设置'];
    active_pid = macViews.indexOf(macView());
}
function set_panel() {} // 平铺布局全部由 main.txt 声明，不调用容器或相对坐标 API。
function UiCompSetCaption() {} // macOS 保持原生标题栏。

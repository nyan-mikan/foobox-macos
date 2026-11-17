// 将原版切换按钮移到播放控制条上方，保留其绘制、点击与提示行为。
var macInitObj = init_obj;
init_obj = function () {
    macInitObj();
    g_switchbar.setSize(12, 4, g_switchbar.w, g_switchbar.h);
};
var macPaint = on_paint;
on_paint = function (gr) {
    active_pid = macViews.indexOf(macView());
    macPaint(gr);
    if (!btnall) g_switchbar.draw(gr);
};
var macMouseMove = on_mouse_move, macMouseDown = on_mouse_lbtn_down, macMouseUp = on_mouse_lbtn_up;
var macPointerOwner = null;
on_mouse_move = function (x, y) {
    macMouseMove(x, y);
    g_switchbar.on_mouse(y < 38 ? 'move' : 'leave', x, y);
};
on_mouse_lbtn_down = function (x, y) {
    // 原生窗口可能只投递按下/松开；点击时重新命中，避免依赖先收到 move。
    on_mouse_move(x, y);
    macPointerOwner = y < 38 ? 'tabs' : 'controls';
    if (macPointerOwner === 'tabs') g_switchbar.on_mouse('lbtn_down', x, y);
    else macMouseDown(x, y);
};
on_mouse_lbtn_up = function (x, y) {
    if (macPointerOwner === 'tabs') {
        g_switchbar.on_mouse('move', x, y);
        g_switchbar.on_mouse('lbtn_up', x, y);
    } else {
        macMouseMove(x, y);
        macMouseUp(x, y); // 跨区域松手仍然结束进度/音量拖动。
    }
    macPointerOwner = null;
};
var macMouseLeave = on_mouse_leave;
on_mouse_leave = function () {
    macMouseLeave();
    if (!btnall) g_switchbar.on_mouse('leave');
};

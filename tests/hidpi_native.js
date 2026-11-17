// 在真实 QuickJS / CoreGraphics 内验证逻辑尺寸、物理缓存和缩放事件。
include(fb.ProfilePath + 'foobox-macos/hidpi.js');
function check(ok, message) { if (!ok) throw new Error(message); }
var expected = Math.max(2, Math.min(8, Math.ceil(Number(panelsui.Eval('%pui_zoom%')) / 50)));
check(fooboxHiDPI.density() === expected, '缓存密度未跟随 zoom');
var image = gdi.CreateImage(40, 40), font = gdi.Font('Helvetica Neue', 13, 0);
var gr = image.GetGraphics();
check(image.Width === 40 && image.Height === 40, '逻辑尺寸发生变化');
check(fooboxHiDPI.bytes(image) === 40 * 40 * expected * expected * 4, 'LRU 没有按物理字节计量');
function draw(gr, x) {
    gr.FillSolidRect(x, 0, 40, 40, 0xff202020);
    gr.FillEllipse(x + 2, 2, 30, 30, 0xff60bbcc);
    gr.DrawLine(x + 5, 5, x + 28, 28, 1, 0xffffffff);
    gr.FillPolygon(0xffffffff, 0, [x + 12, 9, x + 24, 17, x + 12, 25]);
}
draw(gr, 0);
var logicalWidth = gr.CalcTextWidth('foobar 中文', font);
image.ReleaseGraphics(gr);
var padded = gdi.CreateImage(50, 50), pg = padded.GetGraphics();
pg.DrawImage(image, 5, 5, 40, 40, 0, 0, 40, 40);
padded.ReleaseGraphics(pg);
var rawAlias = padded.CreateRawBitmap();
function assertBitmap(bitmap, w, h, r, name) {
    check(bitmap.Width === w && bitmap.Height === h, name + ': 逻辑尺寸错误');
    var path = fb.ProfilePath + 'hidpi-' + name + '.png';
    check(bitmap.SaveAs(path), name + ': 无法保存');
    var raw = gdi.Image(path);
    check(raw.Width === w * r && raw.Height === h * r, name + ': 缓存物理像素不足');
    raw.Dispose();
}
assertBitmap(image, 40, 40, expected, 'original');
assertBitmap(image.Clone(3, 4, 12, 15), 12, 15, expected, 'clone');
assertBitmap(image.Resize(20, 25, 2), 20, 25, expected, 'resize');
assertBitmap(image.ApplyAlpha(128), 40, 40, expected, 'alpha');
assertBitmap(image.InvertColours(), 40, 40, expected, 'invert');
assertBitmap(image.CreateRawBitmap(), 40, 40, expected, 'raw');
var rotation = image.Clone(0, 0, 20, 30);
rotation.RotateFlip(1);
assertBitmap(rotation, 30, 20, expected, 'rotate');
var evaluation = panelsui.Eval, setTimeout = window.SetTimeout, clearTimeout = window.ClearTimeout, reload = window.Reload;
var pending = null, reloadCount = 0, cleared = 0, testZoom = 100;
panelsui.Eval = function () { return String(testZoom); };
var oldMask = gdi.CreateImage(40, 40), wrongMask = gdi.CreateImage(12, 12);
testZoom = 150;
var masked = gdi.CreateImage(40, 40);
var fill = masked.GetGraphics();
fill.FillSolidRect(0, 0, 40, 40, 0xffff0000);
masked.ReleaseGraphics(fill);
var mg = oldMask.GetGraphics();
mg.FillSolidRect(0, 0, 40, 40, 0xffffffff);
oldMask.ReleaseGraphics(mg);
check(masked.ApplyMask(oldMask), '不同密度的同尺寸遮罩无法使用');
check(!masked.ApplyMask(wrongMask), '错误尺寸遮罩改变了 API 语义');
testZoom = 100;
window.SetTimeout = function (fn) { pending = fn; return 1; };
window.ClearTimeout = function () { cleared++; };
window.Reload = function () { reloadCount++; };
fooboxHiDPI.install();
testZoom = 150; on_panelsui_zoom(150);
testZoom = 200; on_panelsui_zoom(200);
check(pending && cleared === 1, '连续缩放事件没有合并');
pending();
check(reloadCount === 1, '缩放后没有重建缓存');
panelsui.Eval = evaluation; window.SetTimeout = setTimeout; window.ClearTimeout = clearTimeout; window.Reload = reload;
fooboxHiDPI.install();
function on_paint(gr) {
    check(fooboxHiDPI.density() === expected, '缩放事件后仍保留旧密度缓存');
    check(gr.CalcTextWidth('foobar 中文', font) === logicalWidth, '主画布与缓存文字测量不一致');
    gr.FillSolidRect(0, 0, window.Width, window.Height, 0xff202020);
    draw(gr, 0); // 左侧直接矢量绘制，右侧走缓存。
    gr.DrawImage(padded, 60, 0, 40, 40, 5, 5, 40, 40);
    // 全白遮罩应使不同密度的红色 bitmap 完全透明，保持下方图形不变。
    gr.DrawImage(masked, 60, 0, 40, 40, 0, 0, 40, 40);
    gr.GdiDrawBitmap(rawAlias, 120, 0, 40, 40, 5, 5, 40, 40);
    gr.GdiAlphaBlend(rawAlias, 180, 0, 40, 40, 5, 5, 40, 40, 255);
    gr.DrawImage(image, 240, 0); // 缺省目标、源尺寸仍为逻辑坐标。
    gr.GdiDrawText('矢量 / 缓存', font, 0xffffffff, 0, 48, 200, 24, 0);
}

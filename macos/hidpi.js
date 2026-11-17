// 离屏缓存使用物理像素，主题和鼠标事件继续使用逻辑坐标。
(function (root) {
    if (root.fooboxHiDPI) return;
    var images = new WeakMap(), graphics = new WeakMap(), fonts = new WeakMap();
    var create = gdi.CreateImage, makeFont = gdi.Font;
    var probe = create(1, 1), bp = Object.getPrototypeOf(probe);
    var measure = probe.GetGraphics(), gp = Object.getPrototypeOf(measure);
    var native = {};
    Object.getOwnPropertyNames(gp).forEach(function (k) {
        if (typeof gp[k] === 'function') native[k] = gp[k];
    });
    var width = Object.getOwnPropertyDescriptor(bp, 'Width').get;
    var height = Object.getOwnPropertyDescriptor(bp, 'Height').get;
    var resize = bp.Resize, clone = bp.Clone, getGraphics = bp.GetGraphics;

    function density() {
        var zoom = typeof panelsui !== 'undefined' && panelsui.IsAvailable ? Number(panelsui.Eval('%pui_zoom%')) : 100;
        return Math.max(2, Math.min(8, Math.ceil(2 * (zoom > 0 ? zoom : 100) / 100)));
    }
    function ratio(image) { return images.get(image) || 1; }
    function tag(image, scale) {
        if (!image || scale === 1) return image;
        images.set(image, scale);
        Object.defineProperties(image, {
            Width: { configurable: true, get: function () { return width.call(this) / ratio(this); } },
            Height: { configurable: true, get: function () { return height.call(this) / ratio(this); } }
        });
        return image;
    }
    function size(w, h) {
        w = Math.trunc(w); h = Math.trunc(h);
        // 与原生 CreateImage 的 64M 像素上限一致；大封面减少倍率而非扩大预算。
        var r = Math.max(1, Math.min(density(), Math.floor(Math.sqrt(64 * 1024 * 1024 / (w * h)))));
        return [w * r, h * r, r];
    }
    function scaledFont(font, r) {
        if (r === 1) return font;
        var cache = fonts.get(font);
        if (!cache) { cache = {}; fonts.set(font, cache); }
        return cache[r] || (cache[r] = makeFont(font.Name, font.Size * r, font.Style));
    }
    function multiply(args, indexes, r) {
        indexes.forEach(function (i) { if (args[i] !== undefined) args[i] *= r; });
    }
    function wrap(name, indexes, fontIndex, transform, result) {
        gp[name] = function () {
            var a = Array.prototype.slice.call(arguments), r = graphics.get(this) || 1;
            multiply(a, indexes, r);
            if (fontIndex !== null) a[fontIndex] = scaledFont(a[fontIndex], r);
            if (transform) transform(a, r);
            var out = native[name].apply(this, a);
            return result ? result(out, r) : out;
        };
    }
    ['FillSolidRect', 'FillEllipse', 'FillGradRect'].forEach(function (n) { wrap(n, [0, 1, 2, 3], null); });
    wrap('FillRoundRect', [0, 1, 2, 3, 4, 5], null);
    wrap('DrawRect', [0, 1, 2, 3, 4], null, function (a, r) { a[2] += r - 1; a[3] += r - 1; });
    wrap('DrawEllipse', [0, 1, 2, 3, 4], null);
    wrap('DrawRoundRect', [0, 1, 2, 3, 4, 5, 6], null);
    wrap('DrawLine', [0, 1, 2, 3, 4], null);
    ['DrawPolygon', 'FillPolygon'].forEach(function (n) {
        wrap(n, n === 'DrawPolygon' ? [1] : [], null, function (a, r) {
            a[2] = a[2].map(function (v) { return v * r; });
        });
    });
    wrap('DrawString', [3, 4, 5, 6], 1);
    wrap('GdiDrawText', [3, 4, 5, 6], 1, null, function (out, r) {
        if (out) for (var i = 0; i < 4; ++i) out[i] /= r;
        return out;
    });
    // 测量始终在原始逻辑字体下进行，避免字体 hinting 或整数取整改变布局。
    ['CalcTextWidth', 'CalcTextHeight', 'MeasureString', 'EstimateLineWrap'].forEach(function (n) {
        gp[n] = function () { return native[n].apply(measure, arguments); };
    });
    ['DrawImage', 'GdiDrawBitmap', 'GdiAlphaBlend'].forEach(function (n) {
        wrap(n, [1, 2, 3, 4], null, function (a, destinationScale) {
            var image = a[0], r = ratio(image);
            if (a[3] === undefined) a[3] = image.Width * destinationScale;
            if (a[4] === undefined) a[4] = image.Height * destinationScale;
            if (a[7] === undefined) a[7] = image.Width;
            if (a[8] === undefined) a[8] = image.Height;
            multiply(a, [5, 6, 7, 8], r);
        });
    });
    gdi.CreateImage = function (w, h) {
        var s = size(w, h);
        return tag(create(s[0], s[1]), s[2]);
    };
    bp.GetGraphics = function () {
        var gr = getGraphics.call(this);
        graphics.set(gr, ratio(this));
        return gr;
    };
    bp.Resize = function (w, h, mode) {
        var s = size(w, h);
        return tag(resize.call(this, s[0], s[1], mode), s[2]);
    };
    bp.Clone = function (x, y, w, h) {
        var r = ratio(this);
        return tag(clone.call(this, (x || 0) * r, (y || 0) * r,
            (w === undefined ? this.Width : w) * r, (h === undefined ? this.Height : h) * r), r);
    };
    ['ApplyAlpha', 'InvertColours', 'CreateRawBitmap'].forEach(function (n) {
        var fn = bp[n];
        bp[n] = function () { return tag(fn.apply(this, arguments), ratio(this)); };
    });
    var blur = bp.StackBlur;
    bp.StackBlur = function (radius) { return blur.call(this, radius * ratio(this)); };
    var mask = bp.ApplyMask;
    bp.ApplyMask = function (image) {
        if (image.Width !== this.Width || image.Height !== this.Height) return false;
        if (ratio(image) === ratio(this)) return mask.call(this, image);
        var copy = resize.call(image, width.call(this), height.call(this), 2);
        try { return mask.call(this, copy); } finally { copy.Dispose(); }
    };
    root.fooboxHiDPI = { density: density,
        bytes: function (image) { return image ? width.call(image) * height.call(image) * 4 : 0; },
        install: function () {
        var previous = root.on_panelsui_zoom, current = density(), pending = 0;
        root.on_panelsui_zoom = function (percent) {
            if (previous) previous(percent);
            var next = density();
            if (next === current) return;
            current = next;
            if (pending) window.ClearTimeout(pending);
            // 缩放事件在绘制后异步投递；下一轮重建六个面板各自的缓存。
            pending = window.SetTimeout(function () { pending = 0; window.Reload(); }, 0);
        };
    } };
})(globalThis);

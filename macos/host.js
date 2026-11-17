// foobox macOS：仅为固定上游补齐宿主差异，不修改播放器的窗口框架。
(function (root) {
    var fso = new ActiveXObject('Scripting.FileSystemObject');
    utils.CreateFolder = function (path) {
        path = String(path).replace(/\\/g, '/').replace(/\/$/, '');
        if (fso.FolderExists(path)) return true;
        var parent = path.slice(0, path.lastIndexOf('/'));
        if (parent && !fso.FolderExists(parent)) utils.CreateFolder(parent);
        fso.CreateFolder(path); return true;
    };
    utils.RenamePath = function (a, b) { fso.MoveFile(a, b); return true; };
    utils.RemovePath = function (path) {
        if (fso.FolderExists(path)) fso.DeleteFolder(path, true);
        else if (fso.FileExists(path)) fso.DeleteFile(path, true);
        return true;
    };
    utils.Run = function (path, args) {
        path = String(path);
        if (/^explorer(?:\.exe)?$/i.test(path) && args && args.length) {
            // NSWorkspace 可以打开目录；没有 Windows 的 /select 参数。
            path = String(args[args.length - 1]).replace(/\\/g, '/').replace(/\/[^/]*$/, '');
        } else if (args && args.length) {
            fb.ShowPopupMessage('此版本不能向外部编辑器传递音轨参数。请在 Finder 中打开文件。', 'foobox Mac');
            return false;
        }
        return new ActiveXObject('WScript.Shell').Run(path);
    };
    fb.ShowPictureViewer = function (path) { return utils.Run(path); };
    utils.FilePicker = function () {
        fb.ShowPopupMessage('此版本暂不支持选择 Windows 外部编辑器。请使用 macOS 原生应用打开音轨。', 'foobox Mac');
        return '';
    };
    utils.EditTextFile = function (path) {
        // SMP 调用方会立即回读并删除文件，不能异步启动 TextEdit 后直接返回。
        var original = utils.ReadTextFile(path);
        var escaped = original.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
        var edited = utils.InputBox(window.ID, '每行用 \\n 分隔；反斜杠用 \\\\。取消保留原文件。', '编辑列表', escaped, false);
        if (edited === escaped) return false;
        edited = String(edited).replace(/\\(\\|r|n)/g, function (_, c) { return c === 'n' ? '\n' : c === 'r' ? '\r' : '\\'; });
        if (!utils.WriteTextFile(path, edited)) throw new Error('无法保存列表：' + path);
        return true;
    };
    utils.GetClipboardText = function () { return new ActiveXObject('htmlfile').parentWindow.clipboardData.getData('text'); };
    utils.SetClipboardText = function (text) { return new ActiveXObject('htmlfile').parentWindow.clipboardData.setData('text', text); };
    var dataDir = String(fb.ProfilePath).replace(/\\/g, '/').replace(/\/$/, '') + '/foobox-macos/data/';
    utils.CreateFolder(dataDir);
    root.GdiFont = function (name, size, style) { return gdi.Font(name, size, style); };

    // 写入临时文件后原子替换；损坏数据绝不默默覆盖。
    function readJSON(path, fallback) {
        if (!utils.FileExists(path)) return fallback;
        try { return JSON.parse(utils.ReadTextFile(path).replace(/^\uFEFF/, '')); }
        catch (e) { throw new Error('foobox Mac 数据损坏，请备份后恢复：' + path + ': ' + e.message); }
    }
    function writeJSON(path, value) {
        if (!utils.WriteTextFile(path + '.tmp', JSON.stringify(value))) throw new Error('无法写入：' + path);
        if (!utils.RenamePath(path + '.tmp', path)) throw new Error('无法提交：' + path);
    }
    // 只实现固定上游实际使用的 SQL 子集。数据是独立 JSON，不读取 Windows SQLite。
    function openDatabase(path) {
        path = String(path).replace(/\\/g, '/');
        if (path.indexOf(dataDir) !== 0 || /\/(?:\.|\.\.)(?:\/|$)/.test(path)) throw new Error('数据库路径越界：' + path);
        path += '.json';
        function load() {
            var state = readJSON(path, { version: 1, tables: {} });
            if (!state || state.version !== 1 || !state.tables || Array.isArray(state.tables) || typeof state.tables !== 'object') throw new Error('不支持的数据库版本或结构：' + path);
            Object.keys(state.tables).forEach(function (key) {
                var value = state.tables[key];
                if (!value || !Array.isArray(value.rows) || value.rows.some(function (row) { return !row || Array.isArray(row) || typeof row !== 'object'; })) throw new Error('数据库表损坏：' + path);
            });
            return state;
        }
        function table(state, name) {
            return state.tables[name] || { primary: null, rows: [] };
        }
        // 每次操作读取最新版本，两个面板共享 albumart 缓存时不丢失更新。
        return {
            Exec: function (sql, args) {
                args = args || [];
                var state = load(), m, t;
                if ((m = /^CREATE TABLE IF NOT EXISTS "(\w+)" \((.+)\)$/i.exec(sql))) {
                    var key = /(\w+) (?:TEXT|INTEGER) PRIMARY KEY/i.exec(m[2]);
                    if (!state.tables[m[1]]) state.tables[m[1]] = { primary: key ? key[1] : null, rows: [] };
                } else if ((m = /^DELETE FROM "(\w+)"(?: WHERE (\w+) = \?)?$/i.exec(sql))) {
                    t = table(state, m[1]);
                    t.rows = m[2] ? t.rows.filter(function (r) { return r[m[2]] !== args[0]; }) : [];
                    state.tables[m[1]] = t;
                } else if ((m = /^INSERT(?: OR (REPLACE|IGNORE))? INTO "(\w+)" \(([^)]+)\) VALUES \(([^)]+)\)$/i.exec(sql))) {
                    var cols = m[3].split(/,\s*/), row = {};
                    if (cols.length !== args.length || !/^\?(?:,\s*\?)*$/.test(m[4])) throw new Error('SQL 参数不匹配：' + sql);
                    cols.forEach(function (c, i) { row[c] = args[i]; });
                    t = table(state, m[2]);
                    var index = t.primary ? t.rows.findIndex(function (r) { return r[t.primary] === row[t.primary]; }) : -1;
                    if (index < 0) t.rows.push(row);
                    else if (m[1] === 'REPLACE') t.rows[index] = row;
                    else if (m[1] !== 'IGNORE') throw new Error('重复主键：' + sql);
                    state.tables[m[2]] = t;
                } else throw new Error('不支持的 SQL：' + sql);
                writeJSON(path, state);
            },
            Query: function (sql) {
                var m = /^SELECT ([\w, ]+) FROM "(\w+)"(?: ORDER BY (\w+))?$/i.exec(sql);
                if (!m) throw new Error('不支持的查询：' + sql);
                var rows = table(load(), m[2]).rows.slice();
                if (m[3] && m[3] !== 'rowid') rows.sort(function (a, b) { return a[m[3]] < b[m[3]] ? -1 : a[m[3]] > b[m[3]] ? 1 : 0; });
                return rows.map(function (r) {
                    var out = {}; m[1].split(/,\s*/).forEach(function (c) { out[c] = r[c]; }); return out;
                });
            }
        };
    }
    utils.OpenDatabase = openDatabase;
    var fileExists = utils.FileExists;
    utils.FileExists = function (path) {
        // 上游用 *.db 是否存在来决定读取；Mac 的实际格式为 *.db.json。
        return fileExists(path) || (/\.db$/.test(path) && fileExists(String(path).replace(/\\/g, '/') + '.json'));
    };

    // 单线程协作式 Worker：保留原始消息协议和原生 bitmap/handle，异步按序执行。
    // 不伪称后台线程；大量封面冷启动可能暂时阻塞 UI。
    function cloneMessage(value) {
        if (Array.isArray(value)) return value.map(cloneMessage);
        if (value && Object.getPrototypeOf(value) === Object.prototype) {
            var copy = {}; Object.keys(value).forEach(function (k) { copy[k] = cloneMessage(value[k]); }); return copy;
        }
        return value;
    }
    root.Worker = function (source, name) {
        var worker = this, stopped = false, queue = [], busy = false;
        function fail(error) {
            if (stopped) return;
            console.log('foobox Mac Worker ' + name + ': ' + error);
            if (worker.onerror) worker.onerror({ message: String(error), error: error });
        }
        var handler = new Function('utils', 'gdi', 'postMessage', 'console',
            'var onmessage;\n' + source + '\nreturn onmessage;')(utils, gdi, function (data) {
                var message = cloneMessage(data);
                window.SetTimeout(function () { if (!stopped && worker.onmessage) worker.onmessage({ data: message }); }, 0);
            }, console);
        function next() {
            if (stopped || busy || !queue.length) return;
            busy = true;
            window.SetTimeout(function () {
                if (stopped) return;
                Promise.resolve().then(function () { return handler({ data: queue.shift() }); }).catch(fail).then(function () {
                    busy = false; next();
                });
            }, 0);
        }
        this.postMessage = function (data) { if (!stopped) { queue.push(cloneMessage(data)); next(); } };
        this.terminate = function () { stopped = true; queue.length = 0; };
    };

    // JS Panel 暂无播放列表 GUID；名称+同名序号保持跨会话身份，主题内重命名同步迁移。
    // 外部重命名和同名列表重排不能可靠追踪，README 明确此限制。
    plman.GetGUID = function (index) {
        if (!Number.isInteger(index) || index < 0 || index >= plman.PlaylistCount) throw new RangeError('无效的播放列表索引：' + index);
        var name = plman.GetPlaylistName(index), ordinal = 0;
        for (var i = 0; i < index; i++) if (plman.GetPlaylistName(i) === name) ordinal++;
        return 'mac:' + encodeURIComponent(name) + ':' + ordinal;
    };
    var rename = plman.RenamePlaylist;
    plman.RenamePlaylist = function (index, name) {
        var before = [], moved = {}, changed = false;
        for (var i = 0; i < plman.PlaylistCount; i++) before.push(plman.GetGUID(i));
        var result = rename(index, name);
        for (var j = 0; j < before.length; j++) {
            var next = plman.GetGUID(j);
            if (before[j] !== next) moved[before[j]] = next;
        }
        if (typeof GroupMap !== 'undefined') {
            var snapshot = Object.assign({}, GroupMap);
            Object.keys(moved).forEach(function (key) { delete GroupMap[key]; });
            Object.keys(moved).forEach(function (key) {
                if (snapshot[key] !== undefined) { GroupMap[moved[key]] = snapshot[key]; changed = true; }
            });
            if (typeof Groups !== 'undefined') Groups.forEach(function (group) {
                if (group.anchor && moved[group.anchor.guid]) { group.anchor.guid = moved[group.anchor.guid]; changed = true; }
            });
            if (changed) save_gdata();
        }
        return result;
    };
    // 仅补齐确有意义的功能；不把缺失接口吞成任意 no-op。
    utils.CRC32 = function (text) {
        var bytes = unescape(encodeURIComponent(String(text))), crc = -1;
        for (var i = 0; i < bytes.length; i++) {
            crc ^= bytes.charCodeAt(i);
            for (var j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
        return (crc ^ -1) >>> 0;
    };
    root.FooboxMac = { dataDir: dataDir, readJSON: readJSON, writeJSON: writeJSON };
})(globalThis);

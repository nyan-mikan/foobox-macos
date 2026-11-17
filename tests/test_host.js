// node --test tests/test_host.js；仅使用内存文件系统，不触及用户 profile。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const code = name => fs.readFileSync(path.join(root, 'macos', name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function host(existingFiles = new Map()) {
    const files = existingFiles, folders = new Set(['/profile']);
    const timers = new Map(), notifications = [], opened = [], popups = [], logs = [];
    const names = ['媒体库', 'Aqours', '同名', '同名'];
    let timerId = 0, clipboard = '', dialog = null, failWrite = false, failRename = false;
    const norm = p => String(p).replaceAll('\\', '/').replace(/\/$/, '');
    function ActiveXObject(id) {
        if (id === 'Scripting.FileSystemObject') return {
            FolderExists: p => folders.has(norm(p)),
            FileExists: p => files.has(norm(p)),
            CreateFolder(p) {
                p = norm(p);
                assert.ok(folders.has(path.posix.dirname(p)), '先创建父目录');
                assert.ok(!folders.has(p), '不重复创建目录');
                folders.add(p);
            },
            MoveFile(a, b) {
                if (failRename) throw new Error('移动失败');
                a = norm(a); b = norm(b);
                assert.ok(files.has(a)); files.set(b, files.get(a)); files.delete(a);
            },
            DeleteFile(p) { files.delete(norm(p)); },
            DeleteFolder(p) {
                p = norm(p); folders.delete(p);
                for (const f of files.keys()) if (f.startsWith(p + '/')) files.delete(f);
            }
        };
        if (id === 'WScript.Shell') return { Run(p) { opened.push(p); return true; } };
        if (id === 'htmlfile') return { parentWindow: { clipboardData: {
            getData: () => clipboard,
            setData(format, value) { clipboard = value; return true; }
        } } };
        throw new Error('未声明的 ActiveX：' + id);
    }
    const context = vm.createContext({
        console: { log: (...args) => logs.push(args.join(' ')) },
        ActiveXObject,
        fb: { ProfilePath: '/profile/', ShowPopupMessage: (...args) => popups.push(args) },
        gdi: { Font: (Name, Size, Style) => ({ Name, Size, Style }) },
        utils: {
            FileExists: p => files.has(norm(p)),
            IsDirectory: p => folders.has(norm(p)),
            ReadTextFile: p => files.get(norm(p)) || '',
            WriteTextFile(p, text) { if (failWrite) return false; files.set(norm(p), text); return true; },
            InputBox: (...args) => dialog === null ? args[3] : dialog
        },
        plman: {
            get PlaylistCount() { return names.length; },
            GetPlaylistName: i => names[i],
            RenamePlaylist: (i, name) => { names[i] = name; return true; }
        },
        window: {
            ID: 12,
            SetTimeout(callback) { timers.set(++timerId, callback); return timerId; },
            ClearTimeout(id) { timers.delete(id); },
            NotifyOthers: (...args) => notifications.push(args),
            Repaint() {}, RepaintRect() {}
        }
    });
    const run = src => vm.runInContext(src, context);
    run(code('host.js'));
    async function drain() {
        // 一轮执行任务队列，再刷新 Promise 微任务；设上限检测死循环。
        for (let i = 0; i < 200; i++) {
            for (let j = 0; j < 8; j++) await Promise.resolve();
            const batch = [...timers.entries()];
            if (!batch.length) return;
            for (const [id, callback] of batch) if (timers.delete(id)) callback();
        }
        throw new Error('异步队列未结束');
    }
    return { context, run, drain, files, folders, notifications, opened, popups, logs, names,
        setDialog: v => { dialog = v; }, failWrite: () => { failWrite = true; }, failRename: () => { failRename = true; } };
}

test('Mac 数据目录与 SMP 文件/字体/剪贴板接口', () => {
    const h = host();
    assert.ok(h.folders.has('/profile/foobox-macos/data'));
    assert.deepEqual(plain(h.run("GdiFont('remixicon', 20, 1)")), { Name: 'remixicon', Size: 20, Style: 1 });
    h.run("utils.CreateFolder('/profile/foobox-macos/data/deep/cache/'); utils.CreateFolder('/profile/foobox-macos/data/deep/cache/');");
    assert.ok(h.folders.has('/profile/foobox-macos/data/deep/cache'));
    assert.equal(h.run("utils.SetClipboardText('中文 日本語'); utils.GetClipboardText()"), '中文 日本語');
    h.run("utils.WriteTextFile('/profile/foobox-macos/data/deep/a', 'x'); utils.RemovePath('/profile/foobox-macos/data/deep');");
    assert.ok(!h.files.has('/profile/foobox-macos/data/deep/a'));
    assert.ok(!('Window' in h.context.fb), '适配层不使用 fb.Window');
});

test('CRC32 使用 UTF-8 字节，并通过标准向量', () => {
    const h = host();
    assert.equal(h.run("utils.CRC32('123456789')"), 0xcbf43926);
    assert.equal(h.run("utils.CRC32('')"), 0);
    // 独立以 Python zlib.crc32('水蓝色'.encode('utf-8')) 核对。
    assert.equal(h.run("utils.CRC32('水蓝色')"), 0xe6addc37);
});

test('上游 SQL 子集：持久化、更新、排序、忽略重复、删除、跨句柄可见', () => {
    const h = host();
    h.run(`
        var db = utils.OpenDatabase('/profile/foobox-macos/data/pm.db');
        db.Exec('CREATE TABLE IF NOT EXISTS "groups" (name TEXT PRIMARY KEY, value TEXT)');
        db.Exec('INSERT OR REPLACE INTO "groups" (name, value) VALUES (?, ?)', ['Aqours', '中文']);
        db.Exec('INSERT OR REPLACE INTO "groups" (name, value) VALUES (?, ?)', ['Aqours', '日本語']);
        db.Exec('INSERT OR IGNORE INTO "groups" (name, value) VALUES (?, ?)', ['Aqours', '忽略']);
        var other = utils.OpenDatabase('/profile/foobox-macos/data/pm.db');
        other.Exec('INSERT OR REPLACE INTO "groups" (name, value) VALUES (?, ?)', ['B', '水蓝色']);
        db.Exec('CREATE TABLE IF NOT EXISTS "radio" (idx INTEGER PRIMARY KEY, name TEXT, url TEXT)');
        db.Exec('INSERT INTO "radio" (idx, name, url) VALUES (?, ?, ?)', [2, '二', 'https://two']);
        db.Exec('INSERT INTO "radio" (idx, name, url) VALUES (?, ?, ?)', [1, '一', 'https://one']);
    `);
    assert.equal(h.run("utils.FileExists('/profile/foobox-macos/data/pm.db')"), true);
    assert.deepEqual(plain(h.run('db.Query(\'SELECT name, value FROM "groups"\')')), [
        { name: 'Aqours', value: '日本語' }, { name: 'B', value: '水蓝色' }
    ]);
    assert.deepEqual(plain(h.run('db.Query(\'SELECT name, url FROM "radio" ORDER BY idx\')')).map(r => r.name), ['一', '二']);
    const reopened = host(h.files);
    assert.equal(reopened.run('utils.OpenDatabase("/profile/foobox-macos/data/pm.db").Query(\'SELECT name, value FROM "groups"\')[0].value'), '日本語');
    h.run('db.Exec(\'DELETE FROM "groups" WHERE name = ?\', ["Aqours"]); db.Exec(\'DELETE FROM "radio"\');');
    assert.equal(h.run('db.Query(\'SELECT name, value FROM "groups"\').length'), 1);
    assert.equal(h.run('db.Query(\'SELECT name, url FROM "radio"\').length'), 0);
    assert.ok([...h.files.keys()].every(p => p.startsWith('/profile/foobox-macos/data/')));
});

test('固定上游所有 SQL 形状实际适用：layout/group/column/cover', () => {
    const h = host();
    h.run(`
        var db = utils.OpenDatabase('/profile/foobox-macos/data/pv.db');
        db.Exec('CREATE TABLE IF NOT EXISTS "layout" (id TEXT PRIMARY KEY, config TEXT, columnWidth TEXT)');
        db.Exec('INSERT OR REPLACE INTO "layout" (id, config, columnWidth) VALUES (?, ?, ?)', ['默认', 'a,b', '100,200']);
        db.Exec('CREATE TABLE IF NOT EXISTS "group" (idx INTEGER PRIMARY KEY, label TEXT, tf TEXT, sort_order TEXT, ref TEXT, l1 TEXT, r1 TEXT, l2 TEXT, r2 TEXT)');
        db.Exec('INSERT OR REPLACE INTO "group" (idx, label, tf, sort_order, ref, l1, r1, l2, r2) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [0, '专辑', '%album%', '', '', '', '', '', '']);
        db.Exec('CREATE TABLE IF NOT EXISTS "column" (idx INTEGER PRIMARY KEY, name TEXT, tf TEXT, tf2 TEXT, ref TEXT, align TEXT, sort_order TEXT)');
        db.Exec('INSERT OR REPLACE INTO "column" (idx, name, tf, tf2, ref, align, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)', [0, '标题', '%title%', '', '', '', '']);
        db.Exec('CREATE TABLE IF NOT EXISTS "artist_album" (crc TEXT PRIMARY KEY)');
        db.Exec('INSERT OR IGNORE INTO "artist_album" (crc) VALUES (?)', ['abcd']);
    `);
    assert.equal(h.run('db.Query(\'SELECT id, config, columnWidth FROM "layout" ORDER BY rowid\')[0].id'), '默认');
    assert.equal(h.run('db.Query(\'SELECT label, tf, sort_order, ref, l1, r1, l2, r2 FROM "group" ORDER BY idx\')[0].label'), '专辑');
    assert.equal(h.run('db.Query(\'SELECT name, tf, tf2, ref, align, sort_order FROM "column" ORDER BY idx\')[0].name'), '标题');
    assert.equal(h.run('db.Query(\'SELECT crc FROM "artist_album"\')[0].crc'), 'abcd');
});

test('执行上游原始管理器存储函数，跨宿主保存分组与电台', () => {
    const source = fs.readFileSync(path.join(root, 'upstream/foobox-cn/script/js_panels/jsspm.js'), 'utf8');
    const functions = source.slice(source.indexOf('function get_gdata(){'), source.indexOf('function reset_radiolist()'))
        .split('foobox\\\\').join('foobox-macos/');
    function initialize(h) {
        h.run(`var pm_db_path = '/profile/foobox-macos/data/pm.db';
            var nonGrouped = [], Groups = [], GroupMap = {}, pm_radio_rows = [];
            var radioname = [], radiom3u = [];`);
        h.run(functions);
    }
    const h = host(); initialize(h);
    h.run(`get_gdata(); Groups = [{id: 'g', name: '水蓝色', collapsed: false}];
        GroupMap[plman.GetGUID(1)] = 'g'; save_gdata();
        radioname = ['日本語']; radiom3u = ['https://radio.test']; save_radiolist();`);
    const restored = host(h.files); initialize(restored); restored.run('get_gdata();');
    assert.equal(restored.run('Groups[0].name'), '水蓝色');
    assert.equal(restored.run('GroupMap[plman.GetGUID(1)]'), 'g');
    assert.deepEqual(plain(restored.run('pm_radio_rows')), [{name: '日本語', url: 'https://radio.test'}]);
    assert.equal(restored.run("nonGrouped.includes('媒体库')"), true);
});

test('不覆盖损坏数据；写入/替换失败保留旧文件；拒绝越界和未知 SQL', () => {
    for (const failure of ['failWrite', 'failRename']) {
        const h = host();
        h.run("FooboxMac.writeJSON('/profile/foobox-macos/data/test.json', {v: 1})");
        h[failure]();
        assert.throws(() => h.run("FooboxMac.writeJSON('/profile/foobox-macos/data/test.json', {v: 2})"));
        assert.equal(h.files.get('/profile/foobox-macos/data/test.json'), '{"v":1}');
    }
    const h = host(new Map([['/profile/foobox-macos/data/broken.db.json', '{broken']]));
    assert.throws(() => h.run('utils.OpenDatabase("/profile/foobox-macos/data/broken.db").Exec(\'CREATE TABLE IF NOT EXISTS "groups" (name TEXT PRIMARY KEY, value TEXT)\')'), /数据损坏/);
    assert.equal(h.files.get('/profile/foobox-macos/data/broken.db.json'), '{broken');
    for (const p of ['/other/pv.db', '/profile/foobox-macos/data/../pv.db', '/profile/foobox-macos/data/.']) {
        assert.throws(() => h.run(`utils.OpenDatabase(${JSON.stringify(p)})`), /越界/);
    }
    assert.throws(() => h.run("utils.OpenDatabase('/profile/foobox-macos/data/pv.db').Exec('DROP TABLE x')"), /不支持/);
    assert.throws(() => h.run("utils.OpenDatabase('/profile/foobox-macos/data/pv.db').Query('SELECT * FROM x')"), /不支持/);
});

test('Worker：异步、隔离、消息快照、按序处理 async、保留原生对象', async () => {
    const h = host();
    h.run(`
        class Bitmap { constructor() { this.Width = 32; } }
        var image = new Bitmap(), replies = [];
        var worker = new Worker('var n = 0; onmessage = async function(e) { await Promise.resolve(); postMessage({count: ++n, payload: e.data}); };', 'test');
        worker.onmessage = function(e) { replies.push(e.data); };
        var payload = {label: '中文', nested: [1, {v: 2}], image: image};
        worker.postMessage(payload); payload.label = '已变'; payload.nested[1].v = 999;
        worker.postMessage({label: '第二条'});
    `);
    assert.equal(h.run('replies.length'), 0);
    await h.drain();
    assert.deepEqual(plain(h.run('replies.map(r => [r.count, r.payload.label])')), [[1, '中文'], [2, '第二条']]);
    assert.equal(h.run('replies[0].payload.nested[1].v'), 2);
    assert.equal(h.run('replies[0].payload.image === image'), true);
    assert.equal(h.run('typeof n'), 'undefined');
});

test('Worker：错误回调后继续；terminate 不交付队列或延迟消息', async () => {
    const h = host();
    h.run(`
        var replies = [], errors = [];
        var w = new Worker('onmessage = async function(e) { if (e.data === 1) throw new Error("expected"); postMessage(e.data); };', 'failure');
        w.onmessage = e => replies.push(e.data); w.onerror = e => errors.push(e.message);
        w.postMessage(1); w.postMessage(2);
        var stopped = new Worker('onmessage = function(e) { postMessage(e.data); };', 'stopped');
        stopped.onmessage = e => replies.push('unexpected'); stopped.postMessage(3); stopped.terminate(); stopped.postMessage(4);
        var late = new Worker('onmessage = function(e) { postMessage(e.data); late.terminate(); };', 'late');
        late.onmessage = e => replies.push('late-unexpected'); late.postMessage(5);
    `);
    await h.drain();
    assert.deepEqual(plain(h.run('replies')), [2]);
    assert.match(h.run('errors[0]'), /expected/);
    assert.equal(h.logs.length, 1);
});

test('执行上游原始 Worker 源码：init/keys/封面缺失/缓存图片/重置', async () => {
    const h = host();
    const upstream = name => fs.readFileSync(path.join(root, 'upstream/foobox-cn/script/js_panels', name), 'utf8');
    h.context.gdi.Image = p => ({ source: p, Width: 60, Height: 40 });
    h.context.utils.GetAlbumArtAsyncV2 = async () => ({ image: null });
    for (const file of ['jsplaylist.js', 'jssb.js']) {
        const text = upstream(file), marker = 'var cover_worker_source = `';
        const start = text.indexOf(marker) + marker.length;
        const sourceLiteral = '`' + text.slice(start, text.indexOf('\n`;', start)) + '\n`';
        // 按原始模板字面量求值，保留其转义与原始消息分支。
        h.run(`var replies = []; var cover = new Worker(${sourceLiteral}, ${JSON.stringify(file)}); cover.onmessage = e => replies.push(e.data);`);
        h.run(`
            cover.postMessage({cmd: 'init', dbPath: '/profile/foobox-macos/data/albumart.db', tables: ['album']});
            cover.postMessage({cmd: 'load_keys', table: 'album'});
            cover.postMessage({cmd: 'preload_cover', path: '/profile/missing.jpg', albumIndex: 0, crc: 'x'});
            cover.postMessage({cmd: 'get_cover', path: '/profile/missing.jpg', albumIndex: 1, crc: 'y', mode: 'album'});
        `);
        await h.drain();
        assert.deepEqual(plain(h.run('replies.map(r => r.cmd)')), ['init_done', 'keys', 'preload_miss', 'cover_image']);
        assert.equal(h.run('replies[3].image'), null);
        h.files.set('/profile/cached.jpg', 'fake image');
        h.run("cover.postMessage({cmd: 'preload_cover', path: '/profile/cached.jpg', albumIndex: 2, crc: 'z'});");
        await h.drain();
        assert.equal(h.run('replies[4].cmd'), 'cached_image');
        if (file === 'jssb.js') {
            h.run("cover.postMessage({cmd: 'reset_table', table: 'album', folder: '/profile/foobox-macos/data/cache'});");
            await h.drain();
            assert.equal(h.run('replies[5].cmd'), 'table_reset');
        }
    }
    assert.equal(h.logs.length, 0, h.logs.join('\n'));
});

test('GUID：同名区分、重排/重启稳定、主题内重命名保留分组、同名重命名不删除', () => {
    const h = host();
    const first = h.run('plman.GetGUID(1)');
    assert.notEqual(h.run('plman.GetGUID(2)'), h.run('plman.GetGUID(3)'));
    h.names.splice(0, 0, h.names.splice(1, 1)[0]);
    assert.equal(h.run('plman.GetGUID(0)'), first);
    h.run('var GroupMap = {}; var saves = 0; function save_gdata() { saves++; } GroupMap[plman.GetGUID(0)] = "g1";');
    h.run('plman.RenamePlaylist(0, "Aqours");');
    assert.equal(h.run('saves'), 0);
    assert.equal(h.run('GroupMap[plman.GetGUID(0)]'), 'g1');
    h.run('plman.RenamePlaylist(0, "水蓝色");');
    assert.equal(h.run('saves'), 1);
    assert.equal(h.run('GroupMap[plman.GetGUID(0)]'), 'g1');
    assert.equal(h.run(`GroupMap[${JSON.stringify(first)}]`), undefined);
    const next = host(); next.names.splice(0, next.names.length, ...h.names);
    assert.equal(next.run('plman.GetGUID(0)'), h.run('plman.GetGUID(0)'));
    assert.throws(() => h.run('plman.GetGUID(-1)'), /索引/);
});

test('重命名同名列表时，所有受影响分组键和锚点一起迁移', () => {
    const h = host();
    h.run(`var GroupMap = {}, saves = 0; function save_gdata() { saves++; }
        GroupMap[plman.GetGUID(2)] = 'first'; GroupMap[plman.GetGUID(3)] = 'second';
        var Groups = [{anchor:{guid:plman.GetGUID(3)}}];
        plman.RenamePlaylist(2, '新名称');`);
    assert.equal(h.run('GroupMap[plman.GetGUID(2)]'), 'first');
    assert.equal(h.run('GroupMap[plman.GetGUID(3)]'), 'second');
    assert.equal(h.run('Groups[0].anchor.guid'), h.run('plman.GetGUID(3)'));
    h.run("plman.RenamePlaylist(1, '同名');");
    assert.equal(h.run('GroupMap[plman.GetGUID(3)]'), 'second');
    assert.equal(h.run('Groups[0].anchor.guid'), h.run('plman.GetGUID(3)'));
});

test('有效 JSON 但损坏的表结构应拒绝写入并保留原文', () => {
    const h = host();
    for (const content of ['null', '{"version":1,"tables":[]}', '{"version":1,"tables":{"a":{"rows":{}}}}']) {
        const file = '/profile/foobox-macos/data/malformed.db.json';
        h.files.set(file, content);
        assert.throws(() => h.run(`utils.OpenDatabase('/profile/foobox-macos/data/malformed.db').Exec('CREATE TABLE IF NOT EXISTS "a" (name TEXT PRIMARY KEY)')`), /数据库/);
        assert.equal(h.files.get(file), content);
    }
});

test('图片与 Finder 映射；不把 Windows 外部编辑器伪称为可运行', () => {
    const h = host();
    h.run("fb.ShowPictureViewer('/profile/封面 image.jpg'); utils.Run('explorer.exe', ['/select,', '/profile/album/cover.jpg']);");
    assert.deepEqual(h.opened, ['/profile/封面 image.jpg', '/profile/album']);
    assert.equal(h.run("utils.FilePicker('外部应用', '', '*.exe', 0)"), '');
    assert.equal(h.run("utils.Run('editor.exe', ['song.flac'])"), false);
    assert.equal(h.popups.length, 2);
});

test('同步列表编辑：Unicode、换行/反斜杠、取消不更改，写入失败上报', () => {
    const h = host(), file = '/profile/foobox-macos/data/radio.list';
    h.files.set(file, '中文: https://one\r\n日本語: https://two');
    assert.equal(h.run(`utils.EditTextFile(${JSON.stringify(file)})`), false);
    assert.equal(h.files.get(file), '中文: https://one\r\n日本語: https://two');
    h.setDialog('水蓝色: https://one\\n日本語: https://two\\n路径\\\\backslash');
    assert.equal(h.run(`utils.EditTextFile(${JSON.stringify(file)})`), true);
    assert.equal(h.files.get(file), '水蓝色: https://one\n日本語: https://two\n路径\\backslash');
    h.failWrite(); h.setDialog('change');
    assert.throws(() => h.run(`utils.EditTextFile(${JSON.stringify(file)})`), /无法保存/);
});

function controls(h) {
    const variables = new Map();
    h.context.panelsui = {
        IsAvailable: true,
        GetVariable: (name, fallback) => variables.get(name) ?? fallback,
        SetVariable: (name, value) => variables.set(name, value)
        // 不提供容器/ShowPanel/MovePanel API；错误使用将直接使测试失败。
    };
    h.run(`var panel = {ico: [], tip: []}; var active_pid = 0; var cfg_map = {winFrame: 0};
        var z = v => v, z4 = 4, z8 = 8;
        var calls = [], btnall = true;
        function init_obj() { calls.push('resize'); }
        function on_paint(gr) { calls.push('paint'); if (btnall) g_switchbar.draw(gr); }
        function on_mouse_move(x, y) { calls.push('move:' + x + ':' + y); }
        function on_mouse_lbtn_down(x, y) { calls.push('down:' + x + ':' + y); }
        function on_mouse_lbtn_up(x, y) { calls.push('up:' + x + ':' + y); }
        function on_mouse_leave() { calls.push('leave'); }
    `);
    h.run(code('controls.js'));
    // 使用实际原版按钮的命中测试/鼠标/提示逻辑，仅替换已授权的容器切换函数。
    const base = fs.readFileSync(path.join(root, 'upstream/foobox-cn/script/js_panels/base.js'), 'utf8');
    let switchbar = base.slice(base.indexOf('var oSwitchbar = function()'), base.indexOf('\nfunction get_panel()'));
    const a = switchbar.indexOf('\tthis.switch_panel = function(id) {');
    const b = switchbar.indexOf('\tthis.draw = function(gr){', a);
    assert.ok(a > 0 && b > a);
    switchbar = switchbar.slice(0, a) + '\tthis.switch_panel = function(id) { macSwitch(id); };\n' + switchbar.slice(b);
    h.run(switchbar);
    h.run("get_panel(); var g_switchbar = new oSwitchbar(); g_switchbar.draw = function() { calls.push('tabs'); };");
    h.run(code('controls-after.js'));
    return variables;
}

test('控件切换：原版按钮实际鼠标命中，五视图变量与 settings 消息一致', () => {
    const h = host(), variables = controls(h);
    h.run('init_obj();');
    assert.equal(h.run('g_switchbar.x'), 12);
    assert.equal(h.run('g_switchbar.y'), 4);
    const expected = ['playlist', 'browser', 'lyrics', 'spectrum', 'settings'];
    for (let i = 1; i < expected.length; i++) {
        const x = 13 + i * 38;
        h.run(`on_mouse_move(${x}, 10); on_mouse_lbtn_down(${x}, 10); on_mouse_lbtn_up(${x}, 10);`);
        assert.equal(variables.get('foobox.view'), expected[i]);
        assert.equal(h.run('active_pid'), i);
        assert.deepEqual(h.notifications.at(-1), ['foobox_setting', i === 4 ? 1 : 0]);
    }
    h.run('on_mouse_move(13, 10); on_mouse_lbtn_down(13, 10); on_mouse_lbtn_up(13, 10);');
    assert.equal(variables.get('foobox.view'), 'playlist');
    assert.deepEqual(h.notifications.at(-1), ['foobox_setting', 0]);
    const count = h.notifications.length;
    h.run('macSwitch(0); macSwitch(6); macSwitch(1.5);');
    assert.equal(h.notifications.length, count);
});

test('控件：保存视图读回、无桥接降级、窄播放条仍显示切换栏、播放操作仍转发', () => {
    const h = host(), variables = controls(h);
    variables.set('foobox.view', 'lyrics');
    h.run('get_panel();'); assert.equal(h.run('active_pid'), 2);
    variables.set('foobox.view', 'corrupt'); assert.equal(h.run('macView()'), 'playlist');
    h.run('calls = []; btnall = false; on_paint({});');
    assert.deepEqual(plain(h.run('calls')), ['paint', 'tabs']);
    h.run('calls = []; on_mouse_lbtn_down(300, 60); on_mouse_lbtn_up(300, 60);');
    assert.deepEqual(plain(h.run('calls')), ['move:300:60', 'down:300:60', 'move:300:60', 'up:300:60']);
    h.run('init_obj(); on_mouse_move(52, 10); on_mouse_leave();');
    assert.equal(h.run('g_switchbar.hover_tab'), 0);
    assert.equal(h.run('g_switchbar.tip_timer'), false);
    h.context.panelsui.IsAvailable = false;
    assert.doesNotThrow(() => h.run('macSwitch(3); set_panel(); UiCompSetCaption();'));
    assert.equal(h.run('macView()'), 'playlist');
});

test('跨区域松手仍转发给播放控件，离开标签区域立即清除悬停', () => {
    const h = host(); controls(h);
    h.run('init_obj(); calls = []; btnall = false; on_mouse_lbtn_down(300, 60); on_mouse_move(52, 10); on_mouse_lbtn_up(52, 10);');
    assert.ok(plain(h.run('calls')).includes('up:52:10'));
    h.run('on_mouse_move(52, 10); on_mouse_move(300, 80);');
    assert.equal(h.run('g_switchbar.hover_tab'), 0);
    assert.equal(h.run('g_switchbar.tip_timer'), false);
});

test('没有预先 mouse move 的原生点击仍切换视图', () => {
    const h = host(), variables = controls(h);
    h.run('init_obj(); on_mouse_lbtn_down(51, 19); on_mouse_lbtn_up(51, 19);');
    assert.equal(variables.get('foobox.view'), 'browser');
    h.run('on_mouse_lbtn_down(127, 19); on_mouse_lbtn_up(127, 19);');
    assert.equal(variables.get('foobox.view'), 'spectrum');
});

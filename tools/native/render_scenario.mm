#include "core/fs_util.h"
#include "core/js_api_util.h"
#include "core/js_engine.h"
#include "mini_titleformat.h"
#include "platform/mac/mac_canvas.h"
#import <Foundation/Foundation.h>
#import <CoreText/CoreText.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

namespace {

struct StillTrack : jsp::Track {
    std::string path;
    std::map<std::string, std::string> fields;
};

struct StillHost : jsp::JsHost {
    std::map<std::string, std::string> fields;
    bool playing = false, paused = false, reloadAsked = false;
    double time = 0, length = 0;
    pui::gfx::ImagePtr art;
    jsp::TrackPtr playingTrack = std::make_shared<StillTrack>();
    jsp::Tracks library;
    std::vector<jsp::LibraryAlbum> albums;
    std::map<int, int> timers;
    std::string profile, properties;
    std::string view;
    float fontSize = 12;
    int zoom = 100;
    bool panels_ui_eval(const std::string& text, std::string& out) override {
        if (text != "%pui_zoom%") return false;
        out = std::to_string(zoom); return true;
    }
    bool ui_font(int, jsp::UiFont& out) override { out = {"Helvetica Neue", fontSize, 0}; return true; }
    std::vector<std::pair<std::string, std::string>> notifications;
    bool panels_ui_available() override { return !view.empty(); }
    bool panels_ui_variable(const std::string& name, std::string& out) override {
        if (name != "foobox.view" || view.empty()) return false;
        out = view; return true;
    }
    void set_panels_ui_variable(const std::string& name, const std::string& value) override {
        if (name == "foobox.view") view = value;
    }
    void notify_others(const std::string& name, const std::string& json, const std::vector<NotifyItem>&) override {
        notifications.push_back({name, json});
    }
    std::string profile_path() override { return profile; }
    std::string bundled_import(const std::string& name) override {
        std::string text;
        return name == "lodash" && read_text_file(JSP_LODASH_PATH, text) ? text : std::string();
    }
    std::string jsp3_path() override { return profile.empty() ? std::string() : profile + "foo_js_panel/jsp3/"; }
    std::string load_properties() override { return properties; }
    std::vector<std::string> playlists = { "Default" };
    std::map<int, jsp::Tracks> items;
    int active = 0;
    int playlist_count() override { return (int)playlists.size(); }
    int active_playlist() override { return active; }
    void set_active_playlist(int p) override {
        if (p >= 0 && p < (int)playlists.size()) active = p;
    }
    std::string playlist_name(int p) override { return p >= 0 && p < (int)playlists.size() ? playlists[(size_t)p] : std::string(); }
    int create_playlist(int p, const std::string& name) override {
        const int at = p < 0 || p > (int)playlists.size() ? (int)playlists.size() : p;
        playlists.insert(playlists.begin() + at, name.empty() ? "New Playlist" : name);
        return at;
    }
    int find_or_create_playlist(const std::string& name, bool) override {
        for (size_t i = 0; i < playlists.size(); ++i)
            if (playlists[i] == name) return (int)i;
        return create_playlist(-1, name);
    }
    bool rename_playlist(int p, const std::string& name) override {
        if (p < 0 || p >= (int)playlists.size()) return false;
        playlists[(size_t)p] = name;
        return true;
    }
    bool remove_playlist(int p, bool) override {
        if (p < 0 || p >= (int)playlists.size()) return false;
        playlists.erase(playlists.begin() + p);
        return true;
    }
    int playlist_item_count(int p) override { return (int)items[p].size(); }
    jsp::Tracks playlist_items(int p, bool) override { return items[p]; }
    std::string sandbox;
    bool may_write(const std::string& path) override {
        if (sandbox.empty()) return true;
        std::error_code ec;
        const auto root = std::filesystem::weakly_canonical(jsp::fs_path(sandbox), ec);
        const auto target = std::filesystem::weakly_canonical(jsp::fs_path(path), ec);
        const auto rel = target.lexically_relative(root);
        return !ec && !rel.empty() && *rel.begin() != "..";
    }
    bool write_text_file(const std::string& path, const std::string& text) override { return may_write(path) && jsp::write_file(path, text); }
    bool save_png(const pui::gfx::Image& img, const std::string& path) override {
        return may_write(path) && pui::gfx::encode_png_file(img, path, std::max(1, img.width()));
    }
    bool repainted = false;
    void repaint() override { repainted = true; }
    void repaint_rect(const pui::gfx::Rect&) override {}
    void set_timer(int id, int ms) override { timers[id] = ms; }
    void kill_timer(int id) override { timers.erase(id); }
    jsp::TrackPtr now_playing() override { return playing ? playingTrack : nullptr; }
    jsp::Tracks library_items() override { return library; }
    std::string track_path(const jsp::TrackPtr& t) override {
        auto* s = dynamic_cast<StillTrack*>(t.get());
        return s ? s->path : std::string();
    }
    std::vector<std::string> format_tracks(const std::string& expr, const jsp::Tracks& tracks) override {
        std::vector<std::string> out;
        for (const auto& t : tracks) {
            auto* s = dynamic_cast<StillTrack*>(t.get());
            auto it = s ? s->fields.find(expr) : decltype(s->fields.end()){};
            if(s && it != s->fields.end()) out.push_back(it->second);
            else { auto old=fields; if(s) fields=s->fields; out.push_back(titleformat(expr)); fields=old; }
        }
        return out;
    }
    void album_art(const jsp::TrackPtr&, int, jsp::ArtDone done) override { done(art, std::string()); }
    pui::gfx::ImagePtr load_image(const std::string& path) override { return pui::gfx::decode_image_file(path); }
    bool image_pixels(const pui::gfx::Image& img, pui::gfx::Pixels& out) override { return pui::gfx::image_pixels(img, out); }
    pui::gfx::ImagePtr image_from_pixels(const pui::gfx::Pixels& px) override { return pui::gfx::image_from_pixels(px); }
    std::unique_ptr<pui::gfx::Canvas> pixels_canvas(pui::gfx::Pixels& px, double scale) override { return pui::gfx::pixels_canvas(px, scale); }
    pui::gfx::ImagePtr album_art_sync(const jsp::TrackPtr&, int, std::string&) override { return art; }
    jsp::LibraryState navidrome_state() override { return albums.empty() ? jsp::LibraryState::Missing : jsp::LibraryState::Ready; }
    void navidrome_albums(jsp::AlbumsDone done) override { done(albums, std::string()); }
    std::string titleformat(const std::string& expr) override {
        auto it = fields.find(expr);
        if (it != fields.end()) return it->second;
        std::vector<std::string> log;
        t::MiniTf tf(log);
        for (const auto& [k,v] : fields) if (k.size()>2 && k.front()=='%' && k.back()=='%') tf.fields[k.substr(1,k.size()-2)] = v;
        return tf.eval(expr);
    }
    std::string version() override { return "2.26.3"; }
    bool dark_mode() override { return true; }
    bool ui_colour(jsp::UiColour kind, uint32_t& out) override {
        out = kind == jsp::UiColour::Background ? 0xff252525 : kind == jsp::UiColour::Highlight || kind == jsp::UiColour::Selection ? 0xff4ab3c7 : 0xffdedede;
        return true;
    }
    int playing_playlist() override { return playing ? 0 : -1; }
    int playlist_focus(int p) override { return items[p].empty() ? -1 : 0; }
    jsp::TrackPtr focus_item() override { return items[active].empty() ? nullptr : items[active][0]; }
    jsp::ItemLocation playing_location() override { return {playing ? 0 : -1, playing ? 0 : -1}; }
    std::vector<bool> playlist_selection(int p) override { return std::vector<bool>(items[p].size(),false); }
    jsp::TrackInfo track_info(const jsp::TrackPtr& t) override {
        jsp::TrackInfo info; info.length=235; info.size=10000000;
        auto* track=dynamic_cast<StillTrack*>(t.get());
        if(track) for(const auto& [k,v]:track->fields) if(k.size()>2 && k.front()=='%' && k.back()=='%') info.meta.push_back({k.substr(1,k.size()-2),{v}});
        return info;
    }
    jsp::Tracks query_items(const jsp::Tracks& tracks,const std::string&,std::string&) override { return tracks; }
    std::vector<jsp::OutputDevice> output_devices() override { return {{"Core Audio : Default", "coreaudio", "default", true}}; }

    bool is_playing() override { return playing; }
    bool is_paused() override { return paused; }
    double playback_time() override { return time; }
    double playback_length() override { return length; }
    void playback(jsp::Playback) override {}
    void console(const std::string& text) override { std::fprintf(stderr, "%s\n", text.c_str()); }
    void reload_script() override { reloadAsked = true; }
    void missing_api(const std::string& name) override { std::fprintf(stderr, "not implemented: %s\n", name.c_str()); }
    bool read_text_file(const std::string& path, std::string& out) override {
        std::error_code ec;
        if (!std::filesystem::is_regular_file(jsp::fs_path(path), ec)) return false;
        out = jsp::decode_text(jsp::read_file(path));
        return true;
    }
};

int usage() {
    std::fprintf(stderr,
                 "usage: render_script SCRIPT.js OUT.png [--size WxH] [--scale S] [--playing] [--paused]\n"
                 "                     [--time SECONDS] [--length SECONDS] [--field 'EXPR=VALUE']... [--art IMAGE]\n"
                 "                     [--library FILE.tsv] [--navidrome FILE.tsv] [--click X,Y]...\n"
                 "                     [--profile DIR] [--properties FILE.json] [--sandbox DIR] [--new-track] [--rounds N]\n"
                 "Runs SCRIPT.js in the JS Panel engine (resize, N rounds of pending timers (3), clicks, then\n"
                 "on_paint) on a CoreGraphics canvas and writes the frame as a PNG. --field answers\n"
                 "fb.TitleFormat(EXPR).Eval();\n"
                 "--art is every album art request's image; --library is the Media Library, a TSV whose first\n"
                 "line holds titleformat expressions and each further line one track's values; --navidrome is\n"
                 "the server's albums, TSV lines id, name, artist, artist id, year, song count. --profile is\n"
                 "fb.ProfilePath, --properties the panel's window.GetProperty values (JSON). --sandbox refuses\n"
                 "every file write, move or delete outside DIR (shell commands, the network and the clipboard\n"
                 "are never reached from this tool). --new-track sends on_playback_new_track after loading.\n");
    return 2;
}

}

int main(int argc, char** argv) {
    if (argc < 3) return usage();
    const std::string script = argv[1], out = argv[2];
    int w = 600, h = 56;
    double scale = 1;
    bool verifyHidpi = false;
    int zoomAfter = 0, loads = 0;
    int rounds = 3;
    StillHost host;
    std::vector<std::pair<int, int>> clicks;
    bool newTrack = false, exercise = false, navigation = false;
    int settingsPage = -1;
    auto read_tsv = [](const char* path) {
        std::vector<std::vector<std::string>> rows;
        std::ifstream in(path);
        std::string line;
        while (std::getline(in, line)) {
            std::vector<std::string> cells;
            std::stringstream ss(line);
            std::string cell;
            while (std::getline(ss, cell, '\t')) cells.push_back(cell);
            if (!cells.empty()) rows.push_back(cells);
        }
        return rows;
    };
    for (int i = 3; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&]() -> const char* { return i + 1 < argc ? argv[++i] : nullptr; };
        if (a == "--size") {
            const char* v = next();
            if (!v || std::sscanf(v, "%dx%d", &w, &h) != 2) return usage();
        } else if (a == "--zoom-after") {
            const char* v = next();
            if (!v) return usage();
            zoomAfter = std::atoi(v);
        } else if (a == "--verify-hidpi") {
            verifyHidpi = true;
        } else if (a == "--zoom") {
            const char* v = next();
            if (!v) return usage();
            host.zoom = std::atoi(v);
            host.view = "playlist";
        } else if (a == "--scale") {
            const char* v = next();
            if (!v) return usage();
            scale = std::atof(v);
        } else if (a == "--rounds") {
            const char* v = next();
            if (!v) return usage();
            rounds = std::max(0, std::atoi(v));
        } else if (a == "--playing") host.playing = true;
        else if (a == "--paused") host.paused = true;
        else if (a == "--time") {
            const char* v = next();
            if (!v) return usage();
            host.time = std::atof(v);
        } else if (a == "--length") {
            const char* v = next();
            if (!v) return usage();
            host.length = std::atof(v);
        } else if (a == "--art") {
            const char* v = next();
            if (!v || !(host.art = pui::gfx::decode_image_file(v))) return usage();
        } else if (a == "--library") {
            const char* v = next();
            if (!v) return usage();
            const auto rows = read_tsv(v);
            for (size_t r = 1; r < rows.size(); ++r) {
                auto t = std::make_shared<StillTrack>();
                t->path = "track" + std::to_string(r);
                for (size_t c = 0; c < rows[0].size() && c < rows[r].size(); ++c) t->fields[rows[0][c]] = rows[r][c];
                host.library.push_back(t);
            }
        } else if (a == "--navidrome") {
            const char* v = next();
            if (!v) return usage();
            for (const auto& r : read_tsv(v))
                if (r.size() >= 6) host.albums.push_back({ r[0], r[1], r[2], r[3], "", "", std::atoi(r[4].c_str()), std::atoi(r[5].c_str()) });
        } else if (a == "--click") {
            const char* v = next();
            int x = 0, y = 0;
            if (!v || std::sscanf(v, "%d,%d", &x, &y) != 2) return usage();
            clicks.emplace_back(x, y);
        } else if (a == "--profile") {
            const char* v = next();
            if (!v) return usage();
            host.profile = v;
            if (!host.profile.empty() && host.profile.back() != '/') host.profile += '/';
        } else if (a == "--new-track") {
            newTrack = true;
        } else if (a == "--sandbox") {
            const char* v = next();
            if (!v) return usage();
            host.sandbox = v;
        } else if (a == "--properties") {
            const char* v = next();
            if (!v || !host.read_text_file(v, host.properties)) return usage();
        } else if (a == "--font-size") {
            const char* v = next(); if (!v) return usage(); host.fontSize = std::atof(v);
        } else if (a == "--navigation") {
            navigation = true; host.view = "playlist";
        } else if (a == "--settings-page") {
            const char* v = next(); if (!v) return usage();
            settingsPage = std::atoi(v); host.view = "settings";
        } else if (a == "--exercise") { exercise = true;
        } else if (a == "--field") {
            const char* v = next();
            const char* eq = v ? std::strchr(v, '=') : nullptr;
            if (!eq) return usage();
            host.fields[std::string(v, eq)] = eq + 1;
        } else return usage();
    }
    std::string source;
    if (!host.read_text_file(script, source)) {
        std::fprintf(stderr, "can't read %s\n", script.c_str());
        return 1;
    }
    if (navigation) source += R"JS(
function verify_drag_start() { if(seekbar.State !== 2) throw Error('未开始真实进度条拖动'); }
function verify_drag_release() { if(seekbar.State === 2) throw Error('跨区域松手未结束拖动'); }
function verify_tab_leave() { if(g_switchbar.hover_tab !== 0) throw Error('窄窗口标签残留悬停'); }
)JS";
    if (auto* t = dynamic_cast<StillTrack*>(host.playingTrack.get())) {
        t->fields = host.fields;
        if (t->path.empty()) t->path = "now-playing";
    }
    host.items[0] = host.library;
    if (!host.library.empty()) host.playingTrack = host.library[0];
    if (!host.profile.empty()) {
        NSString* dir = [NSString stringWithUTF8String:(host.profile + "foo_js_panel/fonts").c_str()];
        for (NSString* f in [[NSFileManager defaultManager] contentsOfDirectoryAtPath:dir error:nil]) {
            NSURL* url = [NSURL fileURLWithPath:[dir stringByAppendingPathComponent:f]];
            if (CTFontManagerRegisterFontsForURL((__bridge CFURLRef)url, kCTFontManagerScopeProcess, nullptr)) std::fprintf(stderr, "font loaded: %s\n", f.UTF8String);
        }
    }
    std::unique_ptr<jsp::JsEngine> owner;
    for (int load = 0; load < 4 && (load == 0 || host.reloadAsked); ++load) {
        loads++;
        if (load > 0) std::fprintf(stderr, "window.Reload: loading the script again\n");
        host.reloadAsked = false;
        host.timers.clear();
        owner.reset();
        owner = std::make_unique<jsp::JsEngine>(host);
        owner->load(source, script);
        owner->resize(w, h);
        if (newTrack) owner->playback_new_track(host.playingTrack);
        if (zoomAfter && load == 0) {
            host.zoom = zoomAfter;
            owner->invoke("on_panelsui_zoom", {zoomAfter});
        }
        for (int round = 0; round < rounds && !host.timers.empty() && !host.reloadAsked; ++round) {
            const auto pending = host.timers;
            for (const auto& [id, ms] : pending) owner->timer(id);
        }
    }
    jsp::JsEngine& engine = *owner;
    if (zoomAfter && loads != 2) { std::fprintf(stderr, "缩放事件未完成一次缓存重载：%d\n", loads); return 1; }
    if (navigation) {
        const std::vector<std::string> views = {"playlist", "browser", "lyrics", "spectrum", "settings", "playlist"};
        for (size_t i = 1; i < views.size(); ++i) {
            const int x = 13 + (i % 5) * 38;
            engine.mouse(jsp::Mouse::LeftDown, x, 10, 1);
            engine.mouse(jsp::Mouse::LeftUp, x, 10, 0);
            if (host.view != views[i] || host.notifications.empty() || host.notifications.back().first != "foobox_setting" || host.notifications.back().second != (views[i] == "settings" ? "1" : "0")) {
                std::fprintf(stderr, "navigation failed: expected %s, got %s\n", views[i].c_str(), host.view.c_str()); return 1;
            }
        }
        engine.mouse(jsp::Mouse::Move, w/2, 55, 0);
        engine.mouse(jsp::Mouse::LeftDown, w/2, 55, 1);
        engine.invoke("verify_drag_start");
        engine.mouse(jsp::Mouse::Move, 52, 10, 1);
        engine.mouse(jsp::Mouse::LeftUp, 52, 10, 0);
        engine.invoke("verify_drag_release");
        if(host.view != "playlist") { std::fprintf(stderr,"拖动不应切换视图\n"); return 1; }
        engine.resize(500, h);
        engine.mouse(jsp::Mouse::Move, 52, 10, 0);
        engine.mouse(jsp::Mouse::Move, 300, 80, 0);
        engine.invoke("verify_tab_leave");
        engine.resize(w, h);
    }
    if (settingsPage >= 0) {
        engine.invoke("show_setting", {settingsPage});
        if (settingsPage == 3) {
            engine.invoke("settings_checkboxes_action", {17, false, 3});
            engine.invoke("settings_checkboxes_action", {17, true, 3});
        }
    }
    for (const auto& [x, y] : clicks) {
        engine.mouse(jsp::Mouse::Move, x, y, 0);
        engine.mouse(jsp::Mouse::LeftDown, x, y, 1);
        engine.mouse(jsp::Mouse::LeftUp, x, y, 0);
    }
    if (exercise) {
        engine.mouse(jsp::Mouse::Move, w/2, h/2, 0);
        engine.wheel(-1); engine.wheel(1);
        engine.key_down(0x28); engine.key_down(0x26);
        engine.invoke("on_key_up", {0x28});
        engine.invoke("on_focus", {true});
        engine.playback_time(30);
        engine.playback_pause(true); engine.playback_pause(false);
        engine.library_changed(jsp::JsEngine::LibraryChange::Changed, host.library);
        engine.invoke("on_playlist_switch");
        engine.invoke("on_playlists_changed");
        engine.mouse(jsp::Mouse::RightUp, w/2, h/2, 0);
        engine.resize(std::max(300,w-100), std::max(250,h-80));
        engine.resize(w,h);
    }
    host.repainted = false;
    auto canvas = std::make_unique<pui::gfx::CGCanvas>(w, h, scale);
    engine.paint(*canvas);
    if (host.repainted && !engine.failed()) {
        canvas = std::make_unique<pui::gfx::CGCanvas>(w, h, scale);
        engine.paint(*canvas);
    }
    if (engine.failed()) {
        std::fprintf(stderr, "script error: %s\n", engine.error().c_str());
        return 1;
    }
    CGImageRef img = canvas->copy_image();
    if (verifyHidpi) {
        // 对比同一图形的直接矢量绘制、缓存绘制和缺省尺寸绘制。
        CFDataRef data = CGDataProviderCopyData(CGImageGetDataProvider(img));
        const UInt8* bytes = CFDataGetBytePtr(data);
        const size_t stride = CGImageGetBytesPerRow(img);
        double error = 0;
        const int side = (int)(40 * scale), offset = (int)(60 * scale);
        for (int y = 0; y < side; ++y) for (int x = 0; x < side; ++x) for (int c = 0; c < 4; ++c) {
            const UInt8 *a = bytes + y * stride + x * 4, *b = a + offset * 4;
            error += std::abs((int)a[c] - (int)b[c]);
            for (int slot = 2; slot <= 4; ++slot)
                if (b[c] != a[offset * slot * 4 + c]) { std::fprintf(stderr, "裁剪、别名或默认尺寸绘制改变了区域\n"); return 1; }
        }
        CFRelease(data);
        error /= side * side * 4;
        if (error > 1.5) { std::fprintf(stderr, "缓存偏离原生矢量绘制：MAE=%f\n", error); return 1; }
        std::printf("高分屏像素对比通过：MAE=%.4f\n", error);
    }
    pui::gfx::ImagePtr image = pui::gfx::image_from_cgimage(img, scale);
    if (!image || !pui::gfx::encode_png_file(*image, out, (int)(w * scale))) {
        std::fprintf(stderr, "can't write %s\n", out.c_str());
        return 1;
    }
    std::printf("%s\n", out.c_str());
    return 0;
}

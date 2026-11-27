#!/usr/bin/env python3
"""Linux 原生窗口；控制台和任务生命周期仍由后台服务管理。"""
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen

try:
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    gi.require_version("WebKit2", "4.1")
    from gi.repository import Gdk, Gio, GLib, Gtk, WebKit2
except (ImportError, ValueError) as error:
    print("缺少 Linux 桌面依赖：" + str(error), file=sys.stderr)
    print("Ubuntu/Debian: sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1", file=sys.stderr)
    print("Fedora: sudo dnf install python3-gobject gtk3 webkit2gtk4.1", file=sys.stderr)
    sys.exit(1)


class AgentControl(Gtk.Application):
    def __init__(self, url):
        super().__init__(application_id="com.guuguo.AgentControl", flags=Gio.ApplicationFlags.FLAGS_NONE)
        self.url = url
        self.window = None
        self.web_context = None
        self.plugin_windows = {}

    def do_activate(self):
        if self.window:
            self.window.present()
            return
        GLib.set_application_name("RemoteDeck")
        Gtk.Settings.get_default().set_property("gtk-application-prefer-dark-theme", True)
        self.window = Gtk.ApplicationWindow(application=self, title="RemoteDeck")
        self.window.set_default_size(1280, 840)
        self.window.set_size_request(760, 520)
        self.window.set_icon_name("agent-control")
        header = Gtk.HeaderBar(title="RemoteDeck", show_close_button=True)
        self.window.set_titlebar(header)

        self.back = self.button(header, "go-previous-symbolic", "返回（Alt+←）", lambda *_: self.web.go_back())
        self.button(header, "go-home-symbolic", "回到控制台", lambda *_: self.web.load_uri(self.url))
        self.button(header, "view-refresh-symbolic", "刷新（Ctrl+R）", lambda *_: self.reload())
        self.build_menu_button(header)
        self.button(header, "web-browser-symbolic", "在浏览器打开", lambda *_: self.open_external(self.active_web().get_uri() or self.url), end=True)

        data = Path(os.environ.get("AGENT_CONTROL_DATA_DIR") or Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "agent-control")
        manager = WebKit2.WebsiteDataManager(base_data_directory=str(data / "desktop/webkit"), base_cache_directory=str(data / "desktop/cache"))
        context = WebKit2.WebContext.new_with_website_data_manager(manager)
        context.connect("download-started", self.download_started)
        self.web_context = context
        self.web = WebKit2.WebView.new_with_context(context)
        self.web.connect("decide-policy", self.decide_policy)
        self.web.connect("permission-request", self.permission_request)
        self.web.get_back_forward_list().connect("changed", lambda *_: self.back.set_sensitive(self.web.can_go_back()))
        self.web.connect("load-changed", self.load_changed)
        self.web.connect("load-failed", self.load_failed)
        self.back.set_sensitive(False)

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.notice = Gtk.InfoBar(message_type=Gtk.MessageType.WARNING, show_close_button=True)
        self.notice.set_no_show_all(True)
        self.notice_label = Gtk.Label(label="", wrap=True)
        self.notice.get_content_area().add(self.notice_label)
        self.notice.get_content_area().show_all()
        self.notice.connect("response", lambda *_: self.notice.hide())
        box.pack_start(self.notice, False, False, 0)
        box.pack_start(self.web, True, True, 0)
        self.window.add(box)
        self.window.connect("key-press-event", self.key_press)
        self.window.show_all()
        # 仅在本机服务未就绪时尝试 start；从不 restart/stop 正在执行的任务。
        threading.Thread(target=self.load_console, daemon=True).start()

    @staticmethod
    def button(header, icon, tooltip, callback, end=False):
        button = Gtk.Button.new_from_icon_name(icon, Gtk.IconSize.BUTTON)
        button.set_tooltip_text(tooltip)
        button.connect("clicked", callback)
        (header.pack_end if end else header.pack_start)(button)
        return button

    def build_menu_button(self, header):
        menu_btn = Gtk.MenuButton()
        menu_btn.set_tooltip_text("视图与服务控制")
        menu_btn.add(Gtk.Image.new_from_icon_name("open-menu-symbolic", Gtk.IconSize.BUTTON))

        popover = Gtk.Popover()
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        box.set_border_width(6)
        items = [
            ("强制刷新（Ctrl+Shift+R）", lambda: self.hard_reload()),
            ("放大（Ctrl+=）", lambda: self.zoom_in()),
            ("缩小（Ctrl+-）", lambda: self.zoom_out()),
            ("实际大小（Ctrl+0）", lambda: self.zoom_reset()),
            ("重启后台本地服务", lambda: self.restart_local_service()),
        ]
        for label, action in items:
            item = Gtk.ModelButton(text=label)
            item.connect("clicked", lambda _btn, fn=action, pop=popover: (pop.popdown(), fn()))
            box.pack_start(item, False, False, 0)
        box.show_all()
        popover.add(box)
        menu_btn.set_popover(popover)
        header.pack_end(menu_btn)
        return menu_btn

    def probe_health(self):
        parsed = urlsplit(self.url)
        try:
            with urlopen(f"{parsed.scheme}://{parsed.netloc}/health", timeout=1.5) as resp:
                return getattr(resp, "status", 200) == 200
        except OSError:
            return False

    def load_console(self):
        parsed = urlsplit(self.url)
        if parsed.hostname in ("127.0.0.1", "localhost", "::1") and not self.probe_health():
            try:
                subprocess.run(["systemctl", "--user", "start", "agent-control.service"], timeout=10, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            except (OSError, subprocess.TimeoutExpired):
                pass
            for _ in range(15):
                if self.probe_health():
                    break
                time.sleep(0.4)
        GLib.idle_add(self.web.load_uri, self.url)

    def show_notice(self, message):
        self.notice_label.set_text(message)
        self.notice.show()

    def active_web(self):
        for win, child_web, _back in self.plugin_windows.values():
            if win.is_active():
                return child_web
        return self.web

    def reload(self):
        target = self.active_web()
        if target.get_uri():
            target.reload()
        else:
            target.load_uri(self.url)

    def hard_reload(self):
        target = self.active_web()
        if target.get_uri():
            target.reload_bypass_cache()
        else:
            target.load_uri(self.url)

    def zoom_in(self):
        target = self.active_web()
        target.set_zoom_level(min(2.0, round(target.get_zoom_level() + 0.1, 2)))

    def zoom_out(self):
        target = self.active_web()
        target.set_zoom_level(max(0.7, round(target.get_zoom_level() - 0.1, 2)))

    def zoom_reset(self):
        self.active_web().set_zoom_level(1.0)

    def restart_local_service(self):
        self.show_notice("正在重启本地 RemoteDeck 服务…")

        def worker():
            try:
                subprocess.run(["systemctl", "--user", "restart", "agent-control.service"], timeout=15, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            except (OSError, subprocess.TimeoutExpired):
                pass
            healthy = False
            for _ in range(20):
                if self.probe_health():
                    healthy = True
                    break
                time.sleep(0.4)
            if healthy:
                GLib.idle_add(self.web.load_uri, self.url)
            else:
                GLib.idle_add(self.show_notice, "服务重启后暂未响应，请执行 agent-control status 查看状态。")

        threading.Thread(target=worker, daemon=True).start()

    def load_changed(self, _web, event):
        if event == WebKit2.LoadEvent.COMMITTED:
            self.notice.hide()

    def load_failed(self, _web, _event, _uri, error):
        if not error.matches(WebKit2.network_error_quark(), WebKit2.NetworkError.CANCELLED):
            self.show_notice("页面暂时无法打开。请确认后台服务已启动，再点击刷新。")
        return False

    def open_external(self, uri):
        try:
            Gtk.show_uri_on_window(self.window, uri, Gdk.CURRENT_TIME)
        except GLib.Error as error:
            self.show_notice("无法打开链接：" + error.message)

    def is_local_url(self, uri):
        parsed = urlsplit(uri)
        home = urlsplit(self.url)
        if parsed.scheme not in ("http", "https"):
            return False
        local_hosts = {home.hostname, "127.0.0.1", "localhost", "::1"}
        if parsed.hostname not in local_hosts:
            return False
        expected_port = home.port or (443 if home.scheme == "https" else 80)
        actual_port = parsed.port or (443 if parsed.scheme == "https" else 80)
        return actual_port == expected_port

    def is_local_plugin_url(self, uri):
        if not self.is_local_url(uri):
            return False
        path = urlsplit(uri).path or ""
        return path == "/apps" or path.startswith("/apps/")

    def plugin_window_key(self, uri):
        parsed = urlsplit(uri)
        parts = [p for p in (parsed.path or "").split("/") if p]
        if len(parts) >= 2 and parts[0] == "apps":
            return f"/apps/{parts[1]}"
        project = parse_qs(parsed.query).get("project", [""])[0]
        if project:
            return f"project:{project}"
        return parsed.path or uri

    def default_child_title(self, uri):
        if self.is_local_plugin_url(uri):
            return "RemoteDeck 插件"
        project = parse_qs(urlsplit(uri).query).get("project", [""])[0]
        if project:
            leaf = Path(project).name
            return f"{leaf} · RemoteDeck" if leaf else "RemoteDeck"
        return "RemoteDeck"

    def open_plugin_window(self, uri):
        key = self.plugin_window_key(uri)
        existing = self.plugin_windows.get(key)
        if existing:
            win, child_web, _back = existing
            win.present()
            if urlsplit(child_web.get_uri() or "").path != urlsplit(uri).path:
                child_web.load_uri(uri)
            return child_web

        default_title = self.default_child_title(uri)
        win = Gtk.Window(title=default_title)
        win.set_default_size(1240, 820)
        win.set_size_request(720, 500)
        win.set_icon_name("agent-control")
        header = Gtk.HeaderBar(title=default_title, show_close_button=True)
        win.set_titlebar(header)

        child_web = WebKit2.WebView.new_with_context(self.web_context)
        child_back = self.button(header, "go-previous-symbolic", "返回（Alt+←）", lambda *_: child_web.go_back())
        child_back.set_sensitive(False)
        self.button(header, "view-refresh-symbolic", "刷新（Ctrl+R）", lambda *_: child_web.reload())
        self.button(header, "web-browser-symbolic", "在浏览器打开", lambda *_: self.open_external(child_web.get_uri() or uri), end=True)

        child_web.connect("decide-policy", self.decide_policy)
        child_web.connect("permission-request", self.permission_request)
        child_web.get_back_forward_list().connect("changed", lambda *_: child_back.set_sensitive(child_web.can_go_back()))
        child_web.connect("notify::title", lambda w, _ps: header.set_title((w.get_title() or "").strip() or default_title))
        win.connect("key-press-event", self.key_press)
        win.connect("destroy", lambda *_: self.plugin_windows.pop(key, None))

        win.add(child_web)
        self.plugin_windows[key] = (win, child_web, child_back)
        win.show_all()
        child_web.load_uri(uri)
        return child_web

    def decide_policy(self, web, decision, kind):
        if kind == WebKit2.PolicyDecisionType.RESPONSE:
            if not decision.is_mime_type_supported():
                decision.download()
                return True
            return False
        if kind not in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION, WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            return False
        action = decision.get_navigation_action()
        uri = action.get_request().get_uri()
        parsed = urlsplit(uri)
        if parsed.scheme in ("http", "https"):
            if not self.is_local_url(uri):
                decision.ignore()
                self.open_external(uri)
                return True
            if kind == WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION:
                decision.ignore()
                if self.is_local_plugin_url(uri) or "project=" in parsed.query:
                    self.open_plugin_window(uri)
                else:
                    web.load_uri(uri)
                return True
            if web is self.web and action.get_navigation_type() == WebKit2.NavigationType.LINK_ACTIVATED and self.is_local_plugin_url(uri):
                decision.ignore()
                self.open_plugin_window(uri)
                return True
        elif parsed.scheme not in ("about", "blob", "data"):
            decision.ignore()
            if parsed.scheme in ("mailto", "tel"):
                self.open_external(uri)
            return True
        return False

    def download_started(self, _context, download):
        download.connect("decide-destination", self.download_destination)
        download.connect("failed", lambda _download, error: self.show_notice("下载未完成：" + error.message) if not error.matches(WebKit2.download_error_quark(), WebKit2.DownloadError.CANCELLED_BY_USER) else None)

    def permission_request(self, _web, request):
        # 语音输入需要原生授权入口；不静默允许麦克风或摄像头。
        if not isinstance(request, WebKit2.UserMediaPermissionRequest):
            return False
        devices = "麦克风和摄像头" if request.props.is_for_video_device else "麦克风"
        dialog = Gtk.MessageDialog(transient_for=self.window, modal=True, message_type=Gtk.MessageType.QUESTION, buttons=Gtk.ButtonsType.YES_NO, text=f"允许当前控制台使用{devices}吗？")
        dialog.format_secondary_text(self.active_web().get_uri() or self.url)
        response = dialog.run()
        dialog.destroy()
        (request.allow if response == Gtk.ResponseType.YES else request.deny)()
        return True

    def download_destination(self, download, filename):
        chooser = Gtk.FileChooserDialog(title="保存文件", parent=self.window, action=Gtk.FileChooserAction.SAVE)
        chooser.add_buttons("取消", Gtk.ResponseType.CANCEL, "保存", Gtk.ResponseType.ACCEPT)
        chooser.set_do_overwrite_confirmation(True)
        chooser.set_current_folder(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) or str(Path.home()))
        chooser.set_current_name(Path(filename).name)
        if chooser.run() == Gtk.ResponseType.ACCEPT:
            download.set_allow_overwrite(True)
            download.set_destination(Path(chooser.get_filename()).as_uri())
        else:
            download.cancel()
        chooser.destroy()
        return True

    def key_press(self, _window, event):
        if event.state & Gdk.ModifierType.MOD1_MASK and event.keyval == Gdk.KEY_Left:
            self.active_web().go_back()
        elif event.state & Gdk.ModifierType.CONTROL_MASK and event.state & Gdk.ModifierType.SHIFT_MASK and event.keyval in (Gdk.KEY_r, Gdk.KEY_R):
            self.hard_reload()
        elif event.state & Gdk.ModifierType.CONTROL_MASK and event.keyval in (Gdk.KEY_r, Gdk.KEY_R):
            self.reload()
        elif event.state & Gdk.ModifierType.CONTROL_MASK and event.keyval in (Gdk.KEY_equal, Gdk.KEY_plus, Gdk.KEY_KP_Add):
            self.zoom_in()
        elif event.state & Gdk.ModifierType.CONTROL_MASK and event.keyval in (Gdk.KEY_minus, Gdk.KEY_KP_Subtract):
            self.zoom_out()
        elif event.state & Gdk.ModifierType.CONTROL_MASK and event.keyval in (Gdk.KEY_0, Gdk.KEY_KP_0):
            self.zoom_reset()
        elif event.state & Gdk.ModifierType.CONTROL_MASK and event.keyval in (Gdk.KEY_q, Gdk.KEY_Q):
            self.quit()
        else:
            return False
        return True


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(0)
    url = os.environ.get("AGENT_CONTROL_URL") or f"http://127.0.0.1:{os.environ.get('PORT', '43310')}/"
    if urlsplit(url).scheme not in ("http", "https") or not urlsplit(url).hostname:
        sys.exit("AGENT_CONTROL_URL 必须是 http(s) 地址")
    sys.exit(AgentControl(url).run([sys.argv[0]]))

import AppKit
import Foundation
import WebKit

private let defaultPort = "43310"
private let launchAgentLabel = "com.guuguo.agent-control"
private let windowBgColor = NSColor(name: nil) { appearance in
  let match = appearance.bestMatch(from: [.darkAqua, .aqua])
  if match == .darkAqua {
    return NSColor(srgbRed: 8 / 255.0, green: 11 / 255.0, blue: 16 / 255.0, alpha: 1.0)
  }
  return NSColor(srgbRed: 244 / 255.0, green: 246 / 255.0, blue: 250 / 255.0, alpha: 1.0)
}

private let localFileContextMenuScript = #"""
(() => {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) return;
  document.addEventListener("contextmenu", (event) => {
    const file = event.target.closest?.("[data-local-file-path]");
    const path = file?.dataset.localFilePath;
    if (!path?.startsWith("/") || path.startsWith("//")) return;
    event.preventDefault();
    window.webkit.messageHandlers.localFileContextMenu.postMessage(path);
  });
})();
"""#

private final class PluginWindowSession {
  let key: String
  let window: NSWindow
  let webView: WKWebView
  let backButton: NSButton
  var navObservation: NSKeyValueObservation?
  var titleObservation: NSKeyValueObservation?

  init(key: String, window: NSWindow, webView: WKWebView, backButton: NSButton) {
    self.key = key
    self.window = window
    self.webView = webView
    self.backButton = backButton
  }
}

final class AgentControlAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuItemValidation, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var backButton: NSButton!
  private var navigationObservation: NSKeyValueObservation?
  private var statusOverlay: NSView!
  private var statusLabel: NSTextField!
  private var retryButton: NSButton!
  private var pluginSessions = [PluginWindowSession]()

  private var targetURL: URL!
  private var healthURL: URL!
  private var repoRoot: String = ""
  private var hasLoadedApp = false
  private var isBootstrapping = false
  private var downloadDestinations = [ObjectIdentifier: URL]()

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.appearance = nil
    configureTargets()
    buildMenuBar()
    buildWindow()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    ensureServerAndLoad()
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if !flag {
      window.makeKeyAndOrderFront(nil)
    }
    NSApp.activate(ignoringOtherApps: true)
    return true
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return false
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    if sender === window {
      sender.orderOut(nil)
      return false
    }
    return true
  }

  func windowWillClose(_ notification: Notification) {
    guard let closing = notification.object as? NSWindow, closing !== window else { return }
    if let idx = pluginSessions.firstIndex(where: { $0.window === closing }) {
      let session = pluginSessions.remove(at: idx)
      session.navObservation = nil
      session.titleObservation = nil
      session.webView.navigationDelegate = nil
      session.webView.uiDelegate = nil
    }
  }

  // MARK: - Configuration

  private func configureTargets() {
    let info = Bundle.main.infoDictionary ?? [:]
    let env = ProcessInfo.processInfo.environment
    let port = (env["PORT"]?.isEmpty == false ? env["PORT"] : nil)
      ?? (info["AgentControlPort"] as? String)
      ?? defaultPort
    if let rawRepo = info["AgentControlRepoRoot"] as? String, !rawRepo.hasPrefix("__") {
      repoRoot = rawRepo
    }

    if let rawUrl = env["AGENT_CONTROL_URL"], let parsed = URL(string: rawUrl) {
      targetURL = parsed
    } else {
      targetURL = URL(string: "http://127.0.0.1:\(port)/")!
    }
    var comps = URLComponents(url: targetURL, resolvingAgainstBaseURL: false) ?? URLComponents()
    comps.path = "/health"
    comps.query = nil
    healthURL = comps.url ?? URL(string: "http://127.0.0.1:\(port)/health")!
  }

  // MARK: - UI Construction

  private func buildWindow() {
    let initialRect = NSRect(x: 0, y: 0, width: 1280, height: 840)
    window = NSWindow(
      contentRect: initialRect,
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "RemoteDeck"
    window.minSize = NSSize(width: 760, height: 520)
    window.backgroundColor = windowBgColor
    window.titlebarAppearsTransparent = true
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.center()
    window.setFrameAutosaveName("AgentControlMainWindow")

    let contentView = NSView(frame: initialRect)
    contentView.wantsLayer = true
    contentView.layer?.backgroundColor = windowBgColor.cgColor
    window.contentView = contentView

    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.preferences.isElementFullscreenEnabled = true
    config.preferences.javaScriptCanOpenWindowsAutomatically = true
    config.userContentController.add(self, name: "localFileContextMenu")
    config.userContentController.addUserScript(WKUserScript(
      source: localFileContextMenuScript,
      injectionTime: .atDocumentEnd,
      forMainFrameOnly: true
    ))

    webView = WKWebView(frame: contentView.bounds, configuration: config)
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    webView.setValue(false, forKey: "drawsBackground")
    if #available(macOS 13.3, *) {
      webView.isInspectable = true
    }
    contentView.addSubview(webView)

    buildNavigationControls()
    buildStatusOverlay(inside: contentView)
  }

  private func buildNavigationControls() {
    let accessory = NSTitlebarAccessoryViewController()
    accessory.layoutAttribute = .left
    accessory.view = NSView(frame: NSRect(x: 0, y: 0, width: 76, height: 26))

    backButton = NSButton(title: "返回", target: self, action: #selector(goBack(_:)))
    backButton.frame = NSRect(x: 6, y: 2, width: 64, height: 22)
    backButton.bezelStyle = .texturedRounded
    backButton.controlSize = .small
    backButton.image = NSImage(systemSymbolName: "chevron.backward", accessibilityDescription: "返回")
    backButton.imagePosition = .imageLeading
    backButton.toolTip = "返回上一页（⌘[）"
    backButton.isHidden = true
    accessory.view.addSubview(backButton)
    window.addTitlebarAccessoryViewController(accessory)

    navigationObservation = webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] view, _ in
      self?.backButton.isEnabled = view.canGoBack
      self?.backButton.isHidden = !view.canGoBack
    }
  }

  private func buildStatusOverlay(inside container: NSView) {
    statusOverlay = NSView(frame: container.bounds)
    statusOverlay.autoresizingMask = [.width, .height]
    statusOverlay.wantsLayer = true
    statusOverlay.layer?.backgroundColor = windowBgColor.cgColor

    let stack = NSStackView()
    stack.orientation = .vertical
    stack.alignment = .centerX
    stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false

    let titleLabel = NSTextField(labelWithString: "RemoteDeck")
    titleLabel.font = NSFont.systemFont(ofSize: 20, weight: .semibold)
    titleLabel.textColor = NSColor(srgbRed: 232 / 255.0, green: 238 / 255.0, blue: 247 / 255.0, alpha: 1.0)

    statusLabel = NSTextField(labelWithString: "正在连接本机服务…")
    statusLabel.font = NSFont.systemFont(ofSize: 13, weight: .regular)
    statusLabel.textColor = NSColor(srgbRed: 147 / 255.0, green: 161 / 255.0, blue: 181 / 255.0, alpha: 1.0)
    statusLabel.alignment = .center

    retryButton = NSButton(title: "重试启动并连接", target: self, action: #selector(retryConnection(_:)))
    retryButton.bezelStyle = .rounded
    retryButton.isHidden = true

    stack.addArrangedSubview(titleLabel)
    stack.addArrangedSubview(statusLabel)
    stack.addArrangedSubview(retryButton)
    statusOverlay.addSubview(stack)

    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: statusOverlay.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: statusOverlay.centerYAnchor),
      stack.widthAnchor.constraint(lessThanOrEqualToConstant: 460),
    ])

    container.addSubview(statusOverlay)
  }

  private func buildMenuBar() {
    let mainMenu = NSMenu()
    NSApp.mainMenu = mainMenu

    // App menu
    let appMenuItem = NSMenuItem()
    mainMenu.addItem(appMenuItem)
    let appMenu = NSMenu()
    appMenuItem.submenu = appMenu
    appMenu.addItem(withTitle: "关于 RemoteDeck", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "隐藏 RemoteDeck", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    let hideOthers = appMenu.addItem(withTitle: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
    hideOthers.keyEquivalentModifierMask = [.command, .option]
    appMenu.addItem(withTitle: "显示全部", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "退出 RemoteDeck", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

    // Edit menu (required for Cmd+C / Cmd+V / Cmd+X / Cmd+A / Cmd+Z in WKWebView)
    let editMenuItem = NSMenuItem()
    mainMenu.addItem(editMenuItem)
    let editMenu = NSMenu(title: "编辑")
    editMenuItem.submenu = editMenu
    editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
    let redoItem = editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "z")
    redoItem.keyEquivalentModifierMask = [.command, .shift]
    editMenu.addItem(.separator())
    editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

    // View / Control menu
    let viewMenuItem = NSMenuItem()
    mainMenu.addItem(viewMenuItem)
    let viewMenu = NSMenu(title: "视图")
    viewMenuItem.submenu = viewMenu
    let backItem = viewMenu.addItem(withTitle: "返回上一页", action: #selector(goBack(_:)), keyEquivalent: "[")
    backItem.target = self
    viewMenu.addItem(.separator())
    viewMenu.addItem(withTitle: "刷新界面", action: #selector(reloadWebView(_:)), keyEquivalent: "r")
    let hardReload = viewMenu.addItem(withTitle: "强制重新加载", action: #selector(hardReloadWebView(_:)), keyEquivalent: "r")
    hardReload.keyEquivalentModifierMask = [.command, .shift]
    viewMenu.addItem(.separator())
    viewMenu.addItem(withTitle: "放大", action: #selector(zoomIn(_:)), keyEquivalent: "=")
    viewMenu.addItem(withTitle: "缩小", action: #selector(zoomOut(_:)), keyEquivalent: "-")
    viewMenu.addItem(withTitle: "实际大小", action: #selector(zoomReset(_:)), keyEquivalent: "0")
    viewMenu.addItem(.separator())
    viewMenu.addItem(withTitle: "在默认浏览器中打开", action: #selector(openInBrowser(_:)), keyEquivalent: "o")
    viewMenu.addItem(withTitle: "重启后台本地服务", action: #selector(restartLocalService(_:)), keyEquivalent: "")

    // Window menu
    let windowMenuItem = NSMenuItem()
    mainMenu.addItem(windowMenuItem)
    let windowMenu = NSMenu(title: "窗口")
    windowMenuItem.submenu = windowMenu
    windowMenu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    NSApp.windowsMenu = windowMenu
  }

  // MARK: - Server Bootstrapping

  private func ensureServerAndLoad() {
    if isBootstrapping { return }
    isBootstrapping = true
    retryButton.isHidden = true
    statusOverlay.isHidden = false
    statusLabel.stringValue = "正在检查 RemoteDeck 服务 (\(targetURL.absoluteString))…"

    probeHealth { [weak self] healthy in
      guard let self else { return }
      if healthy {
        self.isBootstrapping = false
        self.loadTargetURL()
        return
      }
      self.statusLabel.stringValue = "正在自动拉起本地 RemoteDeck 服务…"
      self.startLocalServiceIfNeeded()
      self.pollUntilHealthy(attemptsRemaining: 30)
    }
  }

  private func pollUntilHealthy(attemptsRemaining: Int) {
    probeHealth { [weak self] healthy in
      guard let self else { return }
      if healthy {
        self.isBootstrapping = false
        self.loadTargetURL()
        return
      }
      if attemptsRemaining <= 0 {
        self.isBootstrapping = false
        self.statusOverlay.isHidden = false
        self.statusLabel.stringValue = "未能连接到 \(self.targetURL.absoluteString)，请检查本地服务是否已启动。"
        self.retryButton.isHidden = false
        return
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
        self.pollUntilHealthy(attemptsRemaining: attemptsRemaining - 1)
      }
    }
  }

  private func probeHealth(completion: @escaping (Bool) -> Void) {
    var request = URLRequest(url: healthURL)
    request.timeoutInterval = 0.9
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    URLSession.shared.dataTask(with: request) { _, response, error in
      let ok = error == nil && (response as? HTTPURLResponse)?.statusCode == 200
      DispatchQueue.main.async {
        completion(ok)
      }
    }.resume()
  }

  private func startLocalServiceIfNeeded() {
    DispatchQueue.global(qos: .userInitiated).async { [repoRoot] in
      let uid = String(getuid())
      let plistPath = (NSHomeDirectory() as NSString).appendingPathComponent("Library/LaunchAgents/\(launchAgentLabel).plist")
      if FileManager.default.fileExists(atPath: plistPath) {
        let kicked = self.runCommand("/bin/launchctl", ["kickstart", "-k", "gui/\(uid)/\(launchAgentLabel)"])
        if kicked != 0 {
          _ = self.runCommand("/bin/launchctl", ["load", plistPath])
        }
        return
      }
      let localScript = (repoRoot as NSString).appendingPathComponent("scripts/local-control.sh")
      if !repoRoot.isEmpty, FileManager.default.isExecutableFile(atPath: localScript) {
        _ = self.runCommand("/bin/bash", [localScript, "install"])
      }
    }
  }

  @discardableResult
  private func runCommand(_ executable: String, _ args: [String]) -> Int32 {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: executable)
    proc.arguments = args
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = FileHandle.nullDevice
    do {
      try proc.run()
      proc.waitUntilExit()
      return proc.terminationStatus
    } catch {
      return -1
    }
  }

  private func loadTargetURL() {
    hasLoadedApp = true
    var req = URLRequest(url: targetURL)
    req.cachePolicy = .reloadIgnoringLocalCacheData
    webView.load(req)
  }

  // MARK: - Menu Actions

  @objc private func goBack(_ sender: Any?) {
    let target = activeWebView()
    if target.canGoBack { target.goBack() }
  }

  func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
    if menuItem.action == #selector(goBack(_:)) {
      return activeWebView().canGoBack
    }
    return true
  }

  @objc private func retryConnection(_ sender: Any?) {
    ensureServerAndLoad()
  }

  @objc private func reloadWebView(_ sender: Any?) {
    let target = activeWebView()
    if target === webView && !hasLoadedApp {
      ensureServerAndLoad()
      return
    }
    target.reload()
  }

  @objc private func hardReloadWebView(_ sender: Any?) {
    let target = activeWebView()
    if target === webView && !hasLoadedApp {
      ensureServerAndLoad()
      return
    }
    target.reloadFromOrigin()
  }

  @objc private func zoomIn(_ sender: Any?) {
    let target = activeWebView()
    target.pageZoom = min(2.0, target.pageZoom + 0.1)
  }

  @objc private func zoomOut(_ sender: Any?) {
    let target = activeWebView()
    target.pageZoom = max(0.7, target.pageZoom - 0.1)
  }

  @objc private func zoomReset(_ sender: Any?) {
    activeWebView().pageZoom = 1.0
  }

  @objc private func openInBrowser(_ sender: Any?) {
    NSWorkspace.shared.open(activeWebView().url ?? targetURL)
  }

  @objc private func restartLocalService(_ sender: Any?) {
    hasLoadedApp = false
    statusOverlay.isHidden = false
    retryButton.isHidden = true
    statusLabel.stringValue = "正在重启本地 RemoteDeck 服务…"
    DispatchQueue.global(qos: .userInitiated).async { [weak self, repoRoot] in
      guard let self else { return }
      let localScript = (repoRoot as NSString).appendingPathComponent("scripts/local-control.sh")
      if !repoRoot.isEmpty, FileManager.default.isExecutableFile(atPath: localScript) {
        _ = self.runCommand("/bin/bash", [localScript, "restart"])
      } else {
        let uid = String(getuid())
        _ = self.runCommand("/bin/launchctl", ["kickstart", "-k", "gui/\(uid)/\(launchAgentLabel)"])
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
        self.pollUntilHealthy(attemptsRemaining: 25)
      }
    }
  }

  // MARK: - Local File Context Menu

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "localFileContextMenu",
      message.frameInfo.isMainFrame,
      let sourceURL = message.frameInfo.request.url,
      ["127.0.0.1", "localhost", "::1", "[::1]"].contains(sourceURL.host?.lowercased() ?? ""),
      isLocalAppURL(sourceURL),
      let path = message.body as? String, path.hasPrefix("/"), !path.hasPrefix("//"),
      !path.contains("\0")
    else { return }

    let fileURL = URL(fileURLWithPath: path).standardizedFileURL
    let menu = NSMenu()
    let revealItem = menu.addItem(withTitle: "在 Finder 中显示", action: #selector(revealLocalFile(_:)), keyEquivalent: "")
    revealItem.target = self
    revealItem.representedObject = fileURL
    revealItem.image = NSImage(systemSymbolName: "folder", accessibilityDescription: nil)
    let copyItem = menu.addItem(withTitle: "拷贝文件路径", action: #selector(copyLocalFilePath(_:)), keyEquivalent: "")
    copyItem.target = self
    copyItem.representedObject = fileURL
    copyItem.image = NSImage(systemSymbolName: "doc.on.doc", accessibilityDescription: nil)
    let point = webView.convert(window.mouseLocationOutsideOfEventStream, from: nil)
    menu.popUp(positioning: nil, at: point, in: webView)
  }

  @objc private func revealLocalFile(_ sender: NSMenuItem) {
    guard let fileURL = sender.representedObject as? URL else { return }
    NSWorkspace.shared.activateFileViewerSelecting([fileURL])
  }

  @objc private func copyLocalFilePath(_ sender: NSMenuItem) {
    guard let fileURL = sender.representedObject as? URL else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(fileURL.path, forType: .string)
  }

  // MARK: - WKNavigationDelegate

  private func isLocalAppURL(_ url: URL) -> Bool {
    guard let host = url.host?.lowercased() else { return false }
    let targetHost = targetURL.host?.lowercased() ?? "127.0.0.1"
    let localHosts = Set([targetHost, "127.0.0.1", "localhost", "::1"])
    guard localHosts.contains(host) else { return false }
    let expectedPort = targetURL.port ?? 80
    let actualPort = url.port ?? (url.scheme == "https" ? 443 : 80)
    return actualPort == expectedPort
  }

  private func isLocalPluginAppURL(_ url: URL) -> Bool {
    guard isLocalAppURL(url) else { return false }
    let path = url.path
    return path == "/apps" || path.hasPrefix("/apps/")
  }

  private func pluginWindowKey(for url: URL) -> String {
    let parts = url.pathComponents.filter { $0 != "/" }
    if parts.count >= 2 && parts[0] == "apps" {
      return "/apps/\(parts[1])"
    }
    if let projectCwd = URLComponents(url: url, resolvingAgainstBaseURL: false)?
      .queryItems?.first(where: { $0.name == "project" })?.value,
      !projectCwd.isEmpty {
      return "project:\(projectCwd)"
    }
    return url.path.isEmpty ? url.absoluteString : url.path
  }

  private func defaultChildWindowTitle(for url: URL) -> String {
    if isLocalPluginAppURL(url) {
      return "RemoteDeck 插件"
    }
    if let projectCwd = URLComponents(url: url, resolvingAgainstBaseURL: false)?
      .queryItems?.first(where: { $0.name == "project" })?.value,
      !projectCwd.isEmpty {
      let leaf = URL(fileURLWithPath: projectCwd).lastPathComponent
      return leaf.isEmpty ? "RemoteDeck" : "\(leaf) · RemoteDeck"
    }
    return "RemoteDeck"
  }

  private func activeWebView() -> WKWebView {
    if let keyWin = NSApp.keyWindow,
       let matched = pluginSessions.first(where: { $0.window === keyWin }) {
      return matched.webView
    }
    return webView
  }

  private func hostWindow(for targetWebView: WKWebView?) -> NSWindow {
    return targetWebView?.window ?? NSApp.keyWindow ?? window
  }

  @discardableResult
  private func openPluginWindow(url: URL, configuration: WKWebViewConfiguration? = nil) -> WKWebView {
    let key = pluginWindowKey(for: url)
    if configuration == nil, let existing = pluginSessions.first(where: { $0.key == key }) {
      existing.window.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      if existing.webView.url?.path != url.path {
        existing.webView.load(URLRequest(url: url))
      }
      return existing.webView
    }

    let rect = NSRect(x: 0, y: 0, width: 1240, height: 820)
    let childWindow = NSWindow(
      contentRect: rect,
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    let defaultTitle = defaultChildWindowTitle(for: url)
    childWindow.title = defaultTitle
    childWindow.minSize = NSSize(width: 720, height: 500)
    childWindow.backgroundColor = windowBgColor
    childWindow.titlebarAppearsTransparent = true
    childWindow.isReleasedWhenClosed = false
    childWindow.delegate = self

    let offset = CGFloat((pluginSessions.count + 1) * 24)
    let origin = NSPoint(x: window.frame.origin.x + offset, y: max(40, window.frame.origin.y - offset))
    childWindow.setFrameOrigin(origin)

    let contentView = NSView(frame: rect)
    contentView.wantsLayer = true
    contentView.layer?.backgroundColor = windowBgColor.cgColor
    childWindow.contentView = contentView

    let childConfig: WKWebViewConfiguration
    if let provided = configuration {
      childConfig = provided
    } else {
      childConfig = WKWebViewConfiguration()
      childConfig.websiteDataStore = .default()
      childConfig.preferences.isElementFullscreenEnabled = true
      childConfig.preferences.javaScriptCanOpenWindowsAutomatically = true
      childConfig.userContentController.add(self, name: "localFileContextMenu")
      childConfig.userContentController.addUserScript(WKUserScript(
        source: localFileContextMenuScript,
        injectionTime: .atDocumentEnd,
        forMainFrameOnly: true
      ))
    }

    let childWebView = WKWebView(frame: contentView.bounds, configuration: childConfig)
    childWebView.autoresizingMask = [.width, .height]
    childWebView.navigationDelegate = self
    childWebView.uiDelegate = self
    childWebView.allowsBackForwardNavigationGestures = true
    childWebView.setValue(false, forKey: "drawsBackground")
    if #available(macOS 13.3, *) {
      childWebView.isInspectable = true
    }
    contentView.addSubview(childWebView)

    let accessory = NSTitlebarAccessoryViewController()
    accessory.layoutAttribute = .left
    accessory.view = NSView(frame: NSRect(x: 0, y: 0, width: 76, height: 26))
    let childBack = NSButton(title: "返回", target: self, action: #selector(goBack(_:)))
    childBack.frame = NSRect(x: 6, y: 2, width: 64, height: 22)
    childBack.bezelStyle = .texturedRounded
    childBack.controlSize = .small
    childBack.image = NSImage(systemSymbolName: "chevron.backward", accessibilityDescription: "返回")
    childBack.imagePosition = .imageLeading
    childBack.toolTip = "返回上一页（⌘[）"
    accessory.view.addSubview(childBack)
    childWindow.addTitlebarAccessoryViewController(accessory)

    let session = PluginWindowSession(key: key, window: childWindow, webView: childWebView, backButton: childBack)
    session.navObservation = childWebView.observe(\.canGoBack, options: [.initial, .new]) { view, _ in
      childBack.isEnabled = view.canGoBack
    }
    session.titleObservation = childWebView.observe(\.title, options: [.initial, .new]) { view, _ in
      let pageTitle = view.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      childWindow.title = pageTitle.isEmpty ? defaultTitle : pageTitle
    }
    pluginSessions.append(session)

    if configuration == nil {
      childWebView.load(URLRequest(url: url))
    }
    childWindow.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    return childWebView
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if webView === self.webView {
      statusOverlay.isHidden = true
      retryButton.isHidden = true
    }
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    if webView === self.webView {
      handleLoadError(error)
    }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    if webView === self.webView {
      handleLoadError(error)
    }
  }

  private func handleLoadError(_ error: Error) {
    let nsErr = error as NSError
    if nsErr.domain == NSURLErrorDomain && nsErr.code == NSURLErrorCancelled { return }
    hasLoadedApp = false
    statusOverlay.isHidden = false
    statusLabel.stringValue = "连接中断：\(error.localizedDescription)"
    retryButton.isHidden = false
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else {
      decisionHandler(.allow)
      return
    }
    let scheme = url.scheme?.lowercased() ?? ""
    if scheme == "http" || scheme == "https" {
      if isLocalAppURL(url) {
        if webView === self.webView
          && navigationAction.navigationType == .linkActivated
          && isLocalPluginAppURL(url) {
          openPluginWindow(url: url)
          decisionHandler(.cancel)
          return
        }
        decisionHandler(.allow)
      } else {
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
      }
      return
    }
    if scheme == "about" || scheme == "blob" || scheme == "data" {
      decisionHandler(.allow)
      return
    }
    NSWorkspace.shared.open(url)
    decisionHandler(.cancel)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    if !navigationResponse.canShowMIMEType {
      decisionHandler(.download)
      return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  // MARK: - WKDownloadDelegate

  func download(
    _ download: WKDownload,
    decideDestinationUsing response: URLResponse,
    suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = suggestedFilename
    panel.beginSheetModal(for: window) { [weak self] result in
      guard result == .OK, let dest = panel.url else {
        completionHandler(nil)
        return
      }
      if FileManager.default.fileExists(atPath: dest.path) {
        try? FileManager.default.removeItem(at: dest)
      }
      self?.downloadDestinations[ObjectIdentifier(download)] = dest
      completionHandler(dest)
    }
  }

  func downloadDidFinish(_ download: WKDownload) {
    downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
  }

  // MARK: - WKUIDelegate

  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    guard let url = navigationAction.request.url else { return nil }
    if isLocalAppURL(url) {
      return openPluginWindow(url: url, configuration: configuration)
    }
    NSWorkspace.shared.open(url)
    return nil
  }

  func webView(
    _ webView: WKWebView,
    runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping ([URL]?) -> Void
  ) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.canChooseFiles = true
    panel.beginSheetModal(for: hostWindow(for: webView)) { result in
      completionHandler(result == .OK ? panel.urls : nil)
    }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping () -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = "RemoteDeck"
    alert.informativeText = message
    alert.addButton(withTitle: "确定")
    alert.beginSheetModal(for: hostWindow(for: webView)) { _ in
      completionHandler()
    }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (Bool) -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = "确认操作"
    alert.informativeText = message
    alert.addButton(withTitle: "确定")
    alert.addButton(withTitle: "取消")
    alert.beginSheetModal(for: hostWindow(for: webView)) { response in
      completionHandler(response == .alertFirstButtonReturn)
    }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptTextInputPanelWithPrompt prompt: String,
    defaultText: String?,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping (String?) -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = prompt
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
    field.stringValue = defaultText ?? ""
    alert.accessoryView = field
    alert.addButton(withTitle: "确定")
    alert.addButton(withTitle: "取消")
    alert.beginSheetModal(for: hostWindow(for: webView)) { response in
      completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
    }
  }

  @available(macOS 12.0, *)
  func webView(
    _ webView: WKWebView,
    requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType,
    decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    let host = origin.host.lowercased()
    if host == "127.0.0.1" || host == "localhost" || host == "::1" {
      decisionHandler(.grant)
    } else {
      decisionHandler(.prompt)
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AgentControlAppDelegate()
app.delegate = delegate
app.run()

import Cocoa
import Foundation

struct VerifyFieldSpec {
  let name: String
  let label: String
  let type: String
  let placeholder: String
  let value: String
  let required: Bool
}

struct VerifyItem {
  let id: String
  let title: String
  let subtitle: String
  let source: String
  let kind: String
  let imageDataUrl: String
  let fields: [VerifyFieldSpec]
  let canRefresh: Bool
  let expiresAtMs: Double
}

func parseVerifyItem(_ obj: [String: Any]) -> VerifyItem? {
  guard let id = obj["id"] as? String, !id.isEmpty else { return nil }
  let title = (obj["title"] as? String) ?? "需要人工动态验证"
  let subtitle = (obj["subtitle"] as? String) ?? ""
  let source = (obj["source"] as? String) ?? "Agent"
  let kind = (obj["kind"] as? String) ?? "captcha"
  let imageDataUrl = (obj["imageDataUrl"] as? String) ?? ""
  let canRefresh = (obj["canRefresh"] as? Bool) ?? false
  let expiresAtMs = (obj["expiresAt"] as? Double) ?? Double(Date().timeIntervalSince1970 * 1000.0 + 120_000.0)

  var parsedFields: [VerifyFieldSpec] = []
  if let arr = obj["fields"] as? [[String: Any]] {
    for raw in arr {
      guard let name = raw["name"] as? String, !name.isEmpty else { continue }
      parsedFields.append(
        VerifyFieldSpec(
          name: name,
          label: (raw["label"] as? String) ?? name,
          type: (raw["type"] as? String) ?? "text",
          placeholder: (raw["placeholder"] as? String) ?? "",
          value: (raw["value"] as? String) ?? "",
          required: (raw["required"] as? Bool) ?? true
        )
      )
    }
  }
  if parsedFields.isEmpty {
    parsedFields.append(
      VerifyFieldSpec(
        name: "code",
        label: "验证码",
        type: "text",
        placeholder: "输入结果后回车提交",
        value: "",
        required: true
      )
    )
  }

  return VerifyItem(
    id: id,
    title: title,
    subtitle: subtitle,
    source: source,
    kind: kind,
    imageDataUrl: imageDataUrl,
    fields: parsedFields,
    canRefresh: canRefresh,
    expiresAtMs: expiresAtMs
  )
}

func decodeDataUrlImage(_ dataUrl: String) -> NSImage? {
  let trimmed = dataUrl.trimmingCharacters(in: .whitespacesAndNewlines)
  guard let commaIdx = trimmed.firstIndex(of: ",") else { return nil }
  let b64 = String(trimmed[trimmed.index(after: commaIdx)...])
  guard let data = Data(base64Encoded: b64, options: [.ignoreUnknownCharacters]) else { return nil }
  return NSImage(data: data)
}

final class KeyablePanel: NSPanel {
  var onEscape: (() -> Void)?

  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { true }

  override func cancelOperation(_ sender: Any?) {
    onEscape?()
  }
}

final class VerifyHudController: NSObject, NSApplicationDelegate, NSWindowDelegate {
  private let baseUrl: String
  private let verifyId: String
  private let session: URLSession

  private var panel: KeyablePanel!
  private var item: VerifyItem
  private var countdownLabel: NSTextField!
  private var subtitleLabel: NSTextField?
  private var imageView: NSImageView?
  private var refreshBtn: NSButton?
  private var errorLabel: NSTextField!
  private var submitBtn: NSButton!
  private var cancelBtn: NSButton!
  private var fieldInputs: [(spec: VerifyFieldSpec, control: NSTextField)] = []

  private var countdownTimer: Timer?
  private var pollTimer: Timer?
  private var sigTermSource: DispatchSourceSignal?
  private var isClosing = false
  private var isSubmitting = false
  private var isRefreshing = false

  init(baseUrl: String, verifyId: String, initialItem: VerifyItem, session: URLSession) {
    self.baseUrl = baseUrl.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
    self.verifyId = verifyId
    self.item = initialItem
    self.session = session
    super.init()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    setupSigTermHandler()
    buildWindow()
    startTimers()
    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
    if let first = fieldInputs.first?.control {
      panel.makeFirstResponder(first)
    }
  }

  private func setupSigTermHandler() {
    signal(SIGTERM, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    src.setEventHandler { [weak self] in
      self?.exitCleanly()
    }
    src.resume()
    self.sigTermSource = src
  }

  private func exitCleanly() {
    if isClosing { return }
    isClosing = true
    countdownTimer?.invalidate()
    pollTimer?.invalidate()
    NSApp.terminate(nil)
  }

  private func buildWindow() {
    let width: CGFloat = 430
    let padding: CGFloat = 18

    let hasImage = !item.imageDataUrl.isEmpty
    let hasSubtitle = !item.subtitle.isEmpty

    var contentHeight: CGFloat = padding * 2
    contentHeight += 24 // header row
    if hasSubtitle { contentHeight += 42 }
    if hasImage { contentHeight += 86 }
    contentHeight += CGFloat(item.fields.count) * 58
    contentHeight += 24 // error label
    contentHeight += 38 // footer buttons

    let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    let originX = screenFrame.midX - width / 2.0
    let originY = screenFrame.maxY - contentHeight - max(60, screenFrame.height * 0.14)
    let frame = NSRect(x: originX, y: originY, width: width, height: contentHeight)

    panel = KeyablePanel(
      contentRect: frame,
      styleMask: [.titled, .closable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    panel.titlebarAppearsTransparent = true
    panel.titleVisibility = .hidden
    panel.isMovableByWindowBackground = true
    panel.isFloatingPanel = true
    panel.hidesOnDeactivate = false
    panel.level = .statusBar
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.delegate = self
    panel.onEscape = { [weak self] in
      self?.handleCancel()
    }

    let root = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: width, height: contentHeight))
    root.material = .hudWindow
    root.blendingMode = .behindWindow
    root.state = .active
    root.wantsLayer = true
    root.layer?.cornerRadius = 14
    root.layer?.masksToBounds = true
    root.layer?.borderWidth = 1
    root.layer?.borderColor = NSColor.white.withAlphaComponent(0.16).cgColor
    panel.contentView = root

    var y = contentHeight - padding

    // Header: Source pill + Title + Countdown
    y -= 22
    let badge = NSTextField(labelWithString: " \(item.source) ")
    badge.font = .systemFont(ofSize: 11, weight: .semibold)
    badge.textColor = NSColor(calibratedRed: 0.62, green: 0.80, blue: 1.0, alpha: 1.0)
    badge.backgroundColor = NSColor(calibratedRed: 0.24, green: 0.50, blue: 0.95, alpha: 0.22)
    badge.drawsBackground = true
    badge.wantsLayer = true
    badge.layer?.cornerRadius = 4
    badge.sizeToFit()
    let badgeW = min(110, badge.frame.width + 6)
    badge.frame = NSRect(x: padding, y: y + 2, width: badgeW, height: 18)
    root.addSubview(badge)

    countdownLabel = NSTextField(labelWithString: "")
    countdownLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .semibold)
    countdownLabel.alignment = .right
    countdownLabel.frame = NSRect(x: width - padding - 86, y: y + 1, width: 86, height: 18)
    root.addSubview(countdownLabel)

    let titleX = padding + badgeW + 8
    let titleField = NSTextField(labelWithString: item.title)
    titleField.font = .systemFont(ofSize: 15, weight: .semibold)
    titleField.textColor = .labelColor
    titleField.lineBreakMode = .byTruncatingTail
    titleField.frame = NSRect(x: titleX, y: y, width: width - titleX - padding - 92, height: 22)
    root.addSubview(titleField)

    if hasSubtitle {
      y -= 42
      let sub = NSTextField(wrappingLabelWithString: item.subtitle)
      sub.font = .systemFont(ofSize: 12)
      sub.textColor = .secondaryLabelColor
      sub.maximumNumberOfLines = 2
      sub.frame = NSRect(x: padding, y: y + 4, width: width - padding * 2, height: 34)
      root.addSubview(sub)
      subtitleLabel = sub
    }

    if hasImage {
      y -= 86
      let cardWidth = width - padding * 2
      let imgWrap = NSView(frame: NSRect(x: padding, y: y + 8, width: cardWidth, height: 70))
      imgWrap.wantsLayer = true
      imgWrap.layer?.backgroundColor = NSColor.white.cgColor
      imgWrap.layer?.cornerRadius = 8
      root.addSubview(imgWrap)

      let imgW: CGFloat = item.canRefresh ? cardWidth - 88 : cardWidth - 16
      let iv = NSImageView(frame: NSRect(x: 8, y: 6, width: imgW, height: 58))
      iv.imageScaling = .scaleProportionallyUpOrDown
      iv.image = decodeDataUrlImage(item.imageDataUrl)
      imgWrap.addSubview(iv)
      imageView = iv

      if item.canRefresh {
        let btn = NSButton(title: "刷新图片", target: self, action: #selector(handleRefresh))
        btn.bezelStyle = .rounded
        btn.font = .systemFont(ofSize: 12, weight: .medium)
        btn.frame = NSRect(x: cardWidth - 78, y: 20, width: 70, height: 28)
        imgWrap.addSubview(btn)
        refreshBtn = btn
      }
    }

    var prevField: NSTextField?
    for spec in item.fields {
      y -= 58
      let lbl = NSTextField(labelWithString: spec.required ? "\(spec.label) *" : spec.label)
      lbl.font = .systemFont(ofSize: 12, weight: .medium)
      lbl.textColor = .secondaryLabelColor
      lbl.frame = NSRect(x: padding, y: y + 36, width: width - padding * 2, height: 16)
      root.addSubview(lbl)

      let input: NSTextField
      if spec.type == "password" {
        input = NSSecureTextField(frame: NSRect(x: padding, y: y + 6, width: width - padding * 2, height: 28))
      } else {
        input = NSTextField(frame: NSRect(x: padding, y: y + 6, width: width - padding * 2, height: 28))
      }
      input.bezelStyle = .roundedBezel
      input.font = .systemFont(ofSize: 14)
      input.placeholderString = spec.placeholder
      input.stringValue = spec.value
      input.target = self
      input.action = #selector(onFieldEnter(_:))
      root.addSubview(input)

      if let prev = prevField {
        prev.nextKeyView = input
      }
      prevField = input
      fieldInputs.append((spec: spec, control: input))
    }

    y -= 24
    errorLabel = NSTextField(labelWithString: "")
    errorLabel.font = .systemFont(ofSize: 12)
    errorLabel.textColor = .systemRed
    errorLabel.lineBreakMode = .byTruncatingTail
    errorLabel.frame = NSRect(x: padding, y: y + 4, width: width - padding * 2, height: 18)
    root.addSubview(errorLabel)

    y -= 36
    cancelBtn = NSButton(title: "取消 (Esc)", target: self, action: #selector(handleCancel))
    cancelBtn.bezelStyle = .rounded
    cancelBtn.keyEquivalent = "\u{1b}"
    cancelBtn.frame = NSRect(x: padding, y: y + 2, width: 102, height: 30)
    root.addSubview(cancelBtn)

    submitBtn = NSButton(title: "提交验证 (↵)", target: self, action: #selector(handleSubmit))
    submitBtn.bezelStyle = .rounded
    submitBtn.keyEquivalent = "\r"
    submitBtn.bezelColor = .systemBlue
    submitBtn.frame = NSRect(x: width - padding - 126, y: y + 2, width: 126, height: 30)
    root.addSubview(submitBtn)

    updateCountdownLabel()
  }

  private func startTimers() {
    countdownTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
      self?.updateCountdownLabel()
    }
    pollTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
      self?.pollRemoteStatus()
    }
  }

  private func updateCountdownLabel() {
    let remainSec = max(0, Int(ceil((item.expiresAtMs - Date().timeIntervalSince1970 * 1000.0) / 1000.0)))
    countdownLabel.stringValue = "剩余 \(remainSec)s"
    if remainSec <= 10 {
      countdownLabel.textColor = .systemRed
    } else if remainSec <= 30 {
      countdownLabel.textColor = .systemOrange
    } else {
      countdownLabel.textColor = .secondaryLabelColor
    }
    if remainSec <= 0 {
      exitCleanly()
    }
  }

  private func pollRemoteStatus() {
    if isClosing || isSubmitting { return }
    guard let url = URL(string: "\(baseUrl)/api/human-verify/\(verifyId)") else { return }
    var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 4)
    req.httpMethod = "GET"
    session.dataTask(with: req) { [weak self] data, resp, _ in
      guard let self = self else { return }
      if let http = resp as? HTTPURLResponse, http.statusCode == 404 {
        DispatchQueue.main.async { self.exitCleanly() }
        return
      }
      guard
        let data = data,
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let itemObj = json["item"] as? [String: Any],
        let latest = parseVerifyItem(itemObj)
      else { return }
      DispatchQueue.main.async {
        if latest.imageDataUrl != self.item.imageDataUrl, !latest.imageDataUrl.isEmpty {
          self.imageView?.image = decodeDataUrlImage(latest.imageDataUrl)
        }
        self.item = latest
        self.updateCountdownLabel()
      }
    }.resume()
  }

  @objc private func onFieldEnter(_ sender: Any?) {
    handleSubmit()
  }

  @objc private func handleRefresh() {
    if isRefreshing || isClosing { return }
    isRefreshing = true
    refreshBtn?.isEnabled = false
    errorLabel.stringValue = ""

    guard let url = URL(string: "\(baseUrl)/api/human-verify/\(verifyId)/refresh") else {
      isRefreshing = false
      refreshBtn?.isEnabled = true
      return
    }
    var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = Data("{}".utf8)
    session.dataTask(with: req) { [weak self] data, resp, err in
      DispatchQueue.main.async {
        guard let self = self else { return }
        self.isRefreshing = false
        self.refreshBtn?.isEnabled = true
        if let err = err {
          self.errorLabel.stringValue = "刷新失败: \(err.localizedDescription)"
          return
        }
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 500
        if code == 404 {
          self.exitCleanly()
          return
        }
        guard
          code < 400,
          let data = data,
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let itemObj = json["item"] as? [String: Any],
          let updated = parseVerifyItem(itemObj)
        else {
          self.errorLabel.stringValue = "刷新验证码失败，请重试"
          return
        }
        self.item = updated
        if !updated.imageDataUrl.isEmpty {
          self.imageView?.image = decodeDataUrlImage(updated.imageDataUrl)
        }
        self.updateCountdownLabel()
        if let first = self.fieldInputs.first?.control {
          self.panel.makeFirstResponder(first)
        }
      }
    }.resume()
  }

  @objc private func handleSubmit() {
    if isSubmitting || isClosing { return }
    errorLabel.stringValue = ""

    var values: [String: String] = [:]
    for pair in fieldInputs {
      let val = pair.spec.type == "password"
        ? pair.control.stringValue
        : pair.control.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
      if pair.spec.required && val.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        errorLabel.stringValue = "请填写「\(pair.spec.label)」"
        panel.makeFirstResponder(pair.control)
        return
      }
      values[pair.spec.name] = val
    }

    isSubmitting = true
    submitBtn.isEnabled = false
    let primaryName = fieldInputs.first?.spec.name ?? "code"
    let payload: [String: Any] = [
      "value": values[primaryName] ?? "",
      "values": values,
      "submittedBy": "macos-hud",
    ]
    guard
      let url = URL(string: "\(baseUrl)/api/human-verify/\(verifyId)/submit"),
      let body = try? JSONSerialization.data(withJSONObject: payload)
    else {
      isSubmitting = false
      submitBtn.isEnabled = true
      errorLabel.stringValue = "构造提交请求失败"
      return
    }

    var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = body

    session.dataTask(with: req) { [weak self] data, resp, err in
      DispatchQueue.main.async {
        guard let self = self else { return }
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 500
        if code == 404 {
          self.exitCleanly()
          return
        }
        if err == nil && code < 400 {
          self.exitCleanly()
          return
        }
        self.isSubmitting = false
        self.submitBtn.isEnabled = true
        if
          let data = data,
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let errObj = json["error"] as? [String: Any],
          let msg = errObj["message"] as? String
        {
          self.errorLabel.stringValue = msg
        } else {
          self.errorLabel.stringValue = err?.localizedDescription ?? "提交失败 (HTTP \(code))"
        }
      }
    }.resume()
  }

  @objc private func handleCancel() {
    if isClosing { return }
    isClosing = true
    countdownTimer?.invalidate()
    pollTimer?.invalidate()

    guard let url = URL(string: "\(baseUrl)/api/human-verify/\(verifyId)/cancel") else {
      NSApp.terminate(nil)
      return
    }
    var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = Data("{\"reason\":\"cancelled\",\"submittedBy\":\"macos-hud\"}".utf8)
    session.dataTask(with: req) { _, _, _ in
      DispatchQueue.main.async {
        NSApp.terminate(nil)
      }
    }.resume()
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
      NSApp.terminate(nil)
    }
  }

  func windowWillClose(_ notification: Notification) {
    if !isClosing {
      handleCancel()
    }
  }
}

func main() {
  let args = CommandLine.arguments
  var baseUrl = ""
  var verifyId = ""
  var i = 1
  while i < args.count {
    if args[i] == "--url", i + 1 < args.count {
      baseUrl = args[i + 1]
      i += 2
    } else if args[i] == "--id", i + 1 < args.count {
      verifyId = args[i + 1]
      i += 2
    } else {
      i += 1
    }
  }
  guard !baseUrl.isEmpty, !verifyId.isEmpty else {
    exit(2)
  }

  let config = URLSessionConfiguration.ephemeral
  config.timeoutIntervalForRequest = 10
  let session = URLSession(configuration: config)

  let cleanBase = baseUrl.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
  guard let fetchUrl = URL(string: "\(cleanBase)/api/human-verify/\(verifyId)") else {
    exit(2)
  }

  var initialItem: VerifyItem?
  let sem = DispatchSemaphore(value: 0)
  var req = URLRequest(url: fetchUrl, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
  req.httpMethod = "GET"
  session.dataTask(with: req) { data, resp, _ in
    defer { sem.signal() }
    guard
      let http = resp as? HTTPURLResponse,
      http.statusCode == 200,
      let data = data,
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let itemObj = json["item"] as? [String: Any]
    else { return }
    initialItem = parseVerifyItem(itemObj)
  }.resume()
  _ = sem.wait(timeout: .now() + 5)

  guard let item = initialItem else {
    exit(0)
  }

  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)
  let delegate = VerifyHudController(baseUrl: cleanBase, verifyId: verifyId, initialItem: item, session: session)
  app.delegate = delegate
  app.run()
}

main()

import AppKit
import WebKit
import UserNotifications
import ServiceManagement
import Sparkle

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, UNUserNotificationCenterDelegate {
    var item: NSStatusItem!
    var window: NSWindow?
    var webView: WKWebView?
    var timer: Timer?
    var worker: Process?
    var lastRequest: String?
    var mode = "starting"
    var helpMessage = ""
    var opening = false
    var settingsReturn: SettingsReturnObserver?
    var settingsGuide: SettingsGuide?
    var setupWindow: NSWindow?
    var setupRows: [String: NSView] = [:]
    var setupIcons: [String: NSImageView] = [:]
    var setupHeading: NSTextField?
    var setupDescription: NSTextField?
    var setupPrimary: NSButton?
    var setupLog: NSButton?
    var setupLoginSwitch: NSSwitch?
    var setupLabels: [String: NSTextField] = [:]
    var setupButtons: [String: NSButton] = [:]
    var setupSummary: NSTextField?
    var wasSetupComplete = false
    var setupKeepOpen = false
    var notificationAllowed = false
    var notificationCenterEnabled = false
    var notificationDesktop = false
    var notificationStyle = "unknown"
    var notificationGuideStep: NotificationGuideStep {
        .current(allowed: notificationAllowed, desktop: notificationDesktop, notificationCenter: notificationCenterEnabled, style: notificationStyle)
    }
    var notificationReady = false
    var notificationDetermined = false
    var permissionsChecked = false
    var permissionCheckRunning = false
    var notificationError: String?
    var runtimeReady = false
    var runtimeIssues: [String] = []
    var startupError: String?
    var loginError: String?
    var startupStarted: Date?
    var startupInspected = false
    var attentionRequest: String?
    var pollRunning = false
    var updater: SPUStandardUpdaterController?
    var loginReady: Bool {
        SMAppService.mainApp.status == .enabled || UserDefaults.standard.bool(forKey: "startAtLoginDisabledByUser")
    }
    var setupComplete: Bool {
        permissionsChecked && notificationReady && notificationError == nil && loginReady && runtimeReady && installedCorrectly && startupError == nil
    }
    var installedCorrectly: Bool {
        let path = Bundle.main.bundlePath
        return (path.hasPrefix("/Applications/") || path.hasPrefix(FileManager.default.homeDirectoryForCurrentUser.path + "/Applications/")) && FileManager.default.isWritableFile(atPath: path)
    }
    let origin = "http://127.0.0.1:18420"
    var token: String? {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Igor Browser/token")
        return try? String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "globe", accessibilityDescription: "igor browser")
        UNUserNotificationCenter.current().delegate = self
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.poll() }
        if Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") is String,
           Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") is String {
            updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        }
        refreshSetup()
        updateMenu()
        if CommandLine.arguments.contains("--enable-login") && SMAppService.mainApp.status == .notRegistered {
            do { try SMAppService.mainApp.register() } catch { NSLog("Login registration failed: %@", error.localizedDescription) }
        }
        poll()
        if CommandLine.arguments.contains("--setup") { showSetup() }
        if CommandLine.arguments.contains("--show") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.showBrowser() }
        }
    }

    func startService() {
        guard worker?.isRunning != true, startupError == nil, installedCorrectly,
              let script = Bundle.main.url(forResource: "run-service", withExtension: "sh") else { return }
        guard FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/colima"),
              FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/docker") else {
            startupError = "the browser runtime is missing. install colima and docker to continue."
            refreshSetup(); return
        }
        startupStarted = startupStarted ?? Date()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [script.path]
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Igor Browser")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let log = directory.appendingPathComponent("service.log")
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
        if let handle = try? FileHandle(forWritingTo: log) {
            handle.seekToEndOfFile()
            process.standardOutput = handle
            process.standardError = handle
        }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self = self, self.worker === process, process.terminationStatus != 0 else { return }
                self.startupError = "the browser runtime could not start. check its log, then retry."
                self.runtimeReady = false
                self.showSetup()
                self.refreshSetup()
            }
        }
        do { try process.run(); worker = process } catch { startupError = error.localizedDescription; refreshSetup() }
    }

    func request(_ path: String, post: Bool = false, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard let token = token else {
            completion(.failure(NSError(domain: "IgorBrowser", code: 1, userInfo: [NSLocalizedDescriptionKey: "browser service is starting."])))
            return
        }
        var request = URLRequest(url: URL(string: origin + path)!)
        request.httpMethod = post ? "POST" : "GET"
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 5
        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                if let error = error { completion(.failure(error)); return }
                let object = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any] ?? [:]
                if (response as? HTTPURLResponse)?.statusCode != 200 {
                    completion(.failure(NSError(domain: "IgorBrowser", code: 2, userInfo: [NSLocalizedDescriptionKey: object["error"] as? String ?? "browser unavailable."])))
                } else { completion(.success(object)) }
            }
        }.resume()
    }

    func poll() {
        refreshSetup()
        guard !pollRunning else { return }
        pollRunning = true
        request("/status") { result in
            self.pollRunning = false
            switch result {
            case .failure:
                self.mode = "starting"
                self.runtimeReady = false
                self.startService()
                if let started = self.startupStarted, Date().timeIntervalSince(started) > 30 {
                    self.runtimeIssues = ["the browser is still starting. open the log if it does not become ready."]
                }
            case .success(let status):
                let previousMode = self.mode
                self.mode = status["mode"] as? String ?? "agent"
                let runtime = status["runtime"] as? [String: Any] ?? [:]
                self.runtimeReady = runtime["ready"] as? Bool ?? false
                self.runtimeIssues = runtime["issues"] as? [String] ?? []
                if self.runtimeReady { self.startupError = nil; self.startupStarted = nil }
                if previousMode == "human" && self.mode != "human" { self.hideWindow() }
                if self.mode == "pending", let request = status["request"] as? [String: Any], let id = request["id"] as? String {
                    self.helpMessage = request["message"] as? String ?? "your ai needs your help."
                    if !self.notificationReady || self.notificationError != nil {
                        self.lastRequest = nil
                        if self.attentionRequest != id { self.attentionRequest = id; self.showSetup() }
                    } else if self.lastRequest != id {
                        self.lastRequest = id
                        let content = UNMutableNotificationContent()
                        content.title = "igor browser needs your help"
                        content.body = self.helpMessage
                        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { error in
                            if let error = error {
                                DispatchQueue.main.async {
                                    self.lastRequest = nil
                                    self.notificationError = error.localizedDescription
                                    self.showSetup(); self.refreshSetup()
                                }
                            }
                        }
                    }
                }
            }
            self.renderSetup()
            self.updateMenu()
        }
    }

    func updateMenu() {
        let menu = NSMenu()
        let state = (!runtimeReady && mode != "starting") ? "browser unavailable" : (["agent": "browser ready", "pending": "your help is needed", "human": "you have control", "paused": "browser paused", "starting": "starting browser…"][mode] ?? mode)
        menu.addItem(withTitle: state, action: nil, keyEquivalent: "")
        if mode == "pending" { menu.addItem(withTitle: helpMessage, action: nil, keyEquivalent: "") }
        if !setupComplete { menu.addItem(withTitle: "finish setup…", action: #selector(showSetup), keyEquivalent: "") }
        menu.addItem(.separator())
        menu.addItem(withTitle: "show browser", action: #selector(showBrowser), keyEquivalent: "")
        menu.addItem(withTitle: "settings…", action: #selector(showSetup), keyEquivalent: ",")
        if let updater = updater {
            let update = menu.addItem(withTitle: "check for updates…", action: #selector(SPUStandardUpdaterController.checkForUpdates(_:)), keyEquivalent: "")
            update.target = updater
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: "quit igor browser", action: #selector(quit), keyEquivalent: "q")
        for entry in menu.items where entry.action != nil && entry.target == nil { entry.target = self }
        item.menu = menu
        item.button?.image = NSImage(systemSymbolName: mode == "pending" ? "exclamationmark.bubble" : (setupComplete ? "globe" : "exclamationmark.circle"), accessibilityDescription: state)
        item.button?.toolTip = setupComplete ? state : "igor browser needs setup"
    }

    @objc func enableNotifications() {
        notificationError = nil
        if notificationDetermined {
            openSettingsGuide("notifications")
        } else {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { granted, error in
                DispatchQueue.main.async {
                    self.notificationError = error?.localizedDescription
                    if granted { self.setupKeepOpen = true }
                    self.refreshSetup()
                    if granted { self.openSettingsGuide("notifications") }
                }
            }
        }
    }

    @objc func toggleLogin() {
        loginError = nil
        do {
            switch SMAppService.mainApp.status {
            case .enabled: try SMAppService.mainApp.unregister(); UserDefaults.standard.set(true, forKey: "startAtLoginDisabledByUser")
            case .requiresApproval: openSettingsGuide("login")
            default: try SMAppService.mainApp.register(); UserDefaults.standard.set(false, forKey: "startAtLoginDisabledByUser"); if SMAppService.mainApp.status == .requiresApproval { openSettingsGuide("login") }
            }
        } catch { loginError = error.localizedDescription }
        refreshSetup()
    }

    @objc func showBrowser() {
        guard !opening else { return }
        opening = true
        request("/take-control", post: true) { result in
            self.opening = false
            switch result {
            case .failure(let error): self.runtimeIssues = [error.localizedDescription]; self.showSetup(); self.renderSetup()
            case .success:
                self.mode = "human"
                self.makeWindow()
                guard let token = self.token else { return }
                self.webView?.load(URLRequest(url: URL(string: self.origin + "/viewer#" + token)!))
                NSApp.activate(ignoringOtherApps: true)
                self.window?.makeKeyAndOrderFront(nil)
                self.updateMenu()
                if CommandLine.arguments.contains("--type-test") {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                        self.webView?.evaluateJavaScript("const c=document.querySelector('canvas'); c.focus(); for(const key of 'human-control-ok'){const code=key==='-'?'Minus':'Key'+key.toUpperCase();c.dispatchEvent(new KeyboardEvent('keydown',{key,code,bubbles:true}));c.dispatchEvent(new KeyboardEvent('keyup',{key,code,bubbles:true}));}")
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 12) { self.finish() }
                }
                if let index = CommandLine.arguments.firstIndex(of: "--capture"), index + 1 < CommandLine.arguments.count {
                    let path = CommandLine.arguments[index + 1]
                    DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
                        self.webView?.evaluateJavaScript("JSON.stringify({ready:document.readyState,text:document.body?.innerText,canvas:document.querySelector('canvas')?.toDataURL()})") { value, error in
                            let text = (value as? String) ?? error?.localizedDescription ?? "No document"
                            if let data = text.data(using: .utf8), let info = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                               let encoded = info["canvas"] as? String, let payload = encoded.split(separator: ",").last,
                               let image = Data(base64Encoded: String(payload)) {
                                try? image.write(to: URL(fileURLWithPath: path + ".canvas.png"))
                            }
                            try? "Viewer JavaScript evaluated".write(toFile: path + ".json", atomically: true, encoding: .utf8)
                        }
                        self.webView?.takeSnapshot(with: nil) { image, _ in
                            guard let image = image, let tiff = image.tiffRepresentation,
                                  let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { return }
                            try? png.write(to: URL(fileURLWithPath: path))
                        }
                    }
                }
            }
        }
    }

    func makeWindow() {
        if window != nil { return }
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 850),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "igor browser — you have control"
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("IgorBrowserViewer")
        window.center()
        let view = NSView()
        window.contentView = view
        let label = NSTextField(labelWithString: "automation is paused while you use this browser.")
        let done = NSButton(title: "done — return to agent", target: self, action: #selector(finish))
        done.bezelStyle = .rounded
        let hide = NSButton(title: "hide — keep paused", target: self, action: #selector(hideBrowser))
        hide.bezelStyle = .rounded
        let bar = NSStackView(views: [label, hide, done])
        bar.spacing = 16
        let web = WKWebView()
        web.navigationDelegate = self
        for subview in [bar, web] { subview.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(subview) }
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.topAnchor, constant: 12),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            web.topAnchor.constraint(equalTo: bar.bottomAnchor, constant: 12),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        self.window = window
        self.webView = web
    }

    @objc func finish() {
        request("/resume", post: true) { result in
            switch result {
            case .failure(let error): self.showError(error.localizedDescription)
            case .success: self.hideWindow(); self.poll()
            }
        }
    }

    @objc func hideBrowser() {
        request("/cancel", post: true) { result in
            switch result {
            case .failure(let error): self.showError(error.localizedDescription)
            case .success: self.hideWindow(); self.poll()
            }
        }
    }

    func hideWindow() {
        webView?.loadHTMLString("", baseURL: nil)
        window?.orderOut(nil)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === setupWindow { settingsReturn?.stop(); sender.orderOut(nil); return false }
        hideBrowser(); return false
    }

    func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "igor browser"
        alert.informativeText = message
        alert.runModal()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        decisionHandler(url?.host == "127.0.0.1" && url?.port == 18420 || url?.absoluteString == "about:blank" ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        webView.loadHTMLString("<p>could not open the browser display. check that the service is running.</p>", baseURL: nil)
        runtimeIssues = ["could not open the browser display: " + error.localizedDescription]
        showSetup(); renderSetup()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async {
            self.request("/status") { result in
                if case .success(let status) = result, status["mode"] as? String == "pending",
                   let request = status["request"] as? [String: Any], request["id"] as? String == response.notification.request.identifier {
                    self.showBrowser()
                }
                completionHandler()
            }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list])
    }

    @objc func quit() {
        let beforeShutdown = mode == "agent" ? "/status" : "/cancel"
        request(beforeShutdown, post: mode != "agent") { _ in
            self.request("/shutdown", post: true) { _ in
                self.worker?.terminate()
                let stop = Process()
                stop.executableURL = URL(fileURLWithPath: "/opt/homebrew/bin/colima")
                stop.arguments = ["stop", "igor-browser"]
                stop.standardOutput = FileHandle.nullDevice
                stop.standardError = FileHandle.nullDevice
                try? stop.run()
                NSApp.terminate(nil)
            }
        }
    }
}

@main
struct BrowserApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}

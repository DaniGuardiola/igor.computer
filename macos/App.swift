import AppKit
import WebKit
import UserNotifications
import ServiceManagement
import Sparkle

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, UNUserNotificationCenterDelegate, NSMenuDelegate {
    var item: NSStatusItem!
    var pauseTip: NSPopover?
    var statusMenuOpen = false
    var pauseChangeRunning = false
    var automationPaused = false
    var automationSwitch: NSSwitch?
    var automationBanner: NSTextField?
    var controlButton: NSButton?
    var viewerOpen = false
    var window: NSWindow?
    var webView: WKWebView?
    var desktopBar: NSView?
    var appPins: AppPinStrip?
    var pinStripWidth: NSLayoutConstraint?
    var appMenuButton: NSButton?
    var appsPopover: NSPopover?
    var appMenuKeyMonitor: Any?
    var desktopApps: [[String: Any]] = []
    var pinnedApps: [String] = []
    var currentDesktopWindows: [[String: Any]] = []
    var appSignature = ""
    var appsLoading = false
    var windowStrip: NSScrollView?
    var workspacePicker: NSPopUpButton?
    var workspaceListSignature = ""
    var selectedWorkspace = "shared"
    var workspaceData: [[String: Any]] = []
    var windowChips: NSStackView?
    var windowListSignature = ""
    var windowGeneration = ""
    var windowListRunning = false
    var windowActionRunning = false
    var browserNeedsFocus = false
    var timer: Timer?
    var worker: Process?
    var lastRequest: String?
    var mode = "starting"
    var helpMessage = ""
    var opening = false
    var quitting = false
    var shutdownComplete = false
    var terminationPending = false
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
    var origin: String { UserDefaults.standard.string(forKey: "serverOrigin") ?? "http://127.0.0.1:18420" }
    var token: String? {
        let path = UserDefaults.standard.string(forKey: "serverTokenFile") ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Igor Browser/token").path
        let url = URL(fileURLWithPath: path)
        return try? String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let index = CommandLine.arguments.firstIndex(of: "--server"), index + 1 < CommandLine.arguments.count {
            let value = CommandLine.arguments[index + 1]
            if let url = URL(string: value), url.scheme == "https" || url.host == "127.0.0.1" { UserDefaults.standard.set(value, forKey: "serverOrigin") }
        }
        if let index = CommandLine.arguments.firstIndex(of: "--token-file"), index + 1 < CommandLine.arguments.count { UserDefaults.standard.set(CommandLine.arguments[index + 1], forKey: "serverTokenFile") }
        NSApp.setActivationPolicy(.accessory)
        makeApplicationMenu()
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "globe", accessibilityDescription: "igor vm")
        UNUserNotificationCenter.current().delegate = self
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.poll() }
        if Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") is String,
           Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") is String {
            updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        }
        refreshSetup()
        updateMenu()
        if CommandLine.arguments.contains("--migrate-login") && SMAppService.mainApp.status == .enabled {
            // Refresh the registered path after renaming the installed app.
            do { try SMAppService.mainApp.unregister(); try SMAppService.mainApp.register() }
            catch { loginError = error.localizedDescription }
        }
        if CommandLine.arguments.contains("--enable-login") && SMAppService.mainApp.status == .notRegistered {
            do { try SMAppService.mainApp.register() } catch { NSLog("Login registration failed: %@", error.localizedDescription) }
        }
        if origin == "http://127.0.0.1:18420" { startService() }
        poll()
        if CommandLine.arguments.contains("--setup") { showSetup() }
        if CommandLine.arguments.contains("--show") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.showBrowser() }
        }
    }

    func startService() {
        guard worker?.isRunning != true, startupError == nil, installedCorrectly,
              let script = Bundle.main.url(forResource: "ensure-service", withExtension: "sh") else { return }
        guard origin == "http://127.0.0.1:18420" else { startupError = "could not reach the vm server. check its address and connection."; refreshSetup(); return }
        guard FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/limactl"),
              FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/qemu-system-aarch64"),
              FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/docker") else {
            startupError = "the browser runtime is missing. install lima, qemu and docker to continue."
            refreshSetup(); return
        }
        startupStarted = startupStarted ?? Date()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [script.path]
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Igor VM")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let log = directory.appendingPathComponent("server.log")
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

    func request(_ path: String, post: Bool = false, arguments: [String: Any]? = nil, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard let token = token else {
            completion(.failure(NSError(domain: "IgorBrowser", code: 1, userInfo: [NSLocalizedDescriptionKey: "browser service is starting."])))
            return
        }
        var request = URLRequest(url: URL(string: origin + path)!)
        request.httpMethod = post ? "POST" : "GET"
        if let arguments = arguments {
            request.httpBody = try? JSONSerialization.data(withJSONObject: arguments)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.timeoutInterval = path == "/take-control" ? 180 : (path == "/windows" ? 10 : 5)
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
                self.mode = status["mode"] as? String ?? "agent"
                self.automationPaused = status["automationPaused"] as? Bool ?? false
                self.viewerOpen = status["viewerOpen"] as? Bool ?? false
                self.selectedWorkspace = status["viewedWorkspace"] as? String ?? self.selectedWorkspace
                self.updateAutomationControl()
                let runtime = status["runtime"] as? [String: Any] ?? [:]
                self.runtimeReady = runtime["ready"] as? Bool ?? false
                self.runtimeIssues = runtime["issues"] as? [String] ?? []
                if self.runtimeReady { self.startupError = nil; self.startupStarted = nil }
                if !self.viewerOpen && self.window?.isVisible == true { self.hideWindow() }
                if self.mode == "pending", let request = status["request"] as? [String: Any], let id = request["id"] as? String {
                    self.helpMessage = request["message"] as? String ?? "your ai needs your help."
                    if !self.notificationReady || self.notificationError != nil {
                        self.lastRequest = nil
                        if self.attentionRequest != id { self.attentionRequest = id; self.showSetup() }
                    } else if self.lastRequest != id {
                        self.lastRequest = id
                        let content = UNMutableNotificationContent()
                        content.title = "igor vm needs your help"
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
            self.request("/client-status", post: true, arguments: ["notifications": self.notificationReady, "login": self.loginReady]) { _ in }
            self.renderSetup()
            self.updateMenu()
            self.refreshBrowserWindows()
        }
    }

    func updateMenu() {
        if mode != "paused" { pauseTip?.close() }
        let menu = NSMenu()
        menu.delegate = self
        let state = (!runtimeReady && mode != "starting") ? "vm unavailable" : (["agent": "vm ready", "pending": "your help is needed", "human": "you have control", "paused": "vm paused", "starting": "starting vm…"][mode] ?? mode)
        menu.addItem(withTitle: state, action: nil, keyEquivalent: "")
        if mode == "pending" { menu.addItem(withTitle: helpMessage, action: nil, keyEquivalent: "") }
        if !setupComplete { menu.addItem(withTitle: "finish setup…", action: #selector(showSetup), keyEquivalent: "") }
        menu.addItem(.separator())
        let pause = menu.addItem(withTitle: automationPaused ? "resume automation" : "pause automation", action: #selector(togglePause), keyEquivalent: "")
        pause.isEnabled = !pauseChangeRunning && (["agent", "paused", "human", "pending"].contains(mode))
        menu.autoenablesItems = false
        menu.addItem(withTitle: "open computer", action: #selector(showBrowser), keyEquivalent: "")
        menu.addItem(withTitle: "settings…", action: #selector(showSetup), keyEquivalent: ",")
        if let updater = updater {
            let update = menu.addItem(withTitle: "check for updates…", action: #selector(SPUStandardUpdaterController.checkForUpdates(_:)), keyEquivalent: "")
            update.target = updater
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: "server…", action: #selector(configureServer), keyEquivalent: "")
        menu.addItem(withTitle: "quit igor vm", action: #selector(quit), keyEquivalent: "q")
        for entry in menu.items where entry.action != nil && entry.target == nil { entry.target = self }
        for entry in menu.items where entry.action == nil { entry.isEnabled = false }
        if !statusMenuOpen && pauseTip?.isShown != true { item.menu = menu }
        item.button?.image = NSImage(systemSymbolName: mode == "pending" ? "exclamationmark.bubble" : (mode == "paused" ? "pause.circle" : (setupComplete ? "globe" : "exclamationmark.circle")), accessibilityDescription: state)
        item.button?.toolTip = setupComplete ? state : "igor vm needs setup"
        if mode != "paused" { pauseTip?.close() }
        else { schedulePauseTip() }
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
        request(CommandLine.arguments.contains("--type-test") ? "/take-control" : "/watch", post: true) { result in
            self.opening = false
            switch result {
            case .failure(let error): self.runtimeIssues = [error.localizedDescription]; self.showSetup(); self.renderSetup()
            case .success(let status):
                self.automationPaused = status["automationPaused"] as? Bool ?? false
                self.mode = status["mode"] as? String ?? "agent"
                self.viewerOpen = true
                self.selectedWorkspace = status["viewedWorkspace"] as? String ?? "shared"
                self.makeWindow()
                guard let token = self.token else { return }
                self.webView?.load(URLRequest(url: URL(string: self.origin + "/viewer?native=1#" + token)!))
                self.prepareVisibleInterface()
                NSApp.activate(ignoringOtherApps: true)
                self.window?.makeKeyAndOrderFront(nil)
                self.updateMenu()
                self.browserNeedsFocus = false
                self.refreshBrowserWindows()
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
                        if let frameView = self.window?.contentView?.superview {
                            let rect = NSRect(x: 0, y: frameView.bounds.maxY - 72, width: frameView.bounds.width, height: 72)
                            if let bitmap = frameView.bitmapImageRepForCachingDisplay(in: rect) {
                                frameView.cacheDisplay(in: rect, to: bitmap)
                                try? bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path + ".toolbar.png"))
                            }
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
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1152, height: 800),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "igor vm · you have control"
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("IgorBrowserViewer")
        let view = NSView()
        window.contentView = view
        configureBrowserToolbar(window)
        configureAutomationBanner(window)
        // Constrain the browser area, not the outer frame including its toolbar.
        let displayRatio = NSSize(width: 1440, height: 1000)
        // The bottom taskbar has a fixed height; resize the desktop independently.
        window.contentMinSize = NSSize(width: 640, height: 640 * displayRatio.height / displayRatio.width + 48)
        let toolbarHeight = window.frame.height - window.contentLayoutRect.height
        let available = (window.screen ?? NSScreen.main)?.visibleFrame.size ?? NSSize(width: 1440, height: 1000)
        let width = min(window.contentLayoutRect.width, available.width,
                        max(1, available.height - toolbarHeight - 48) * displayRatio.width / displayRatio.height)
        window.setContentSize(NSSize(width: width, height: width * displayRatio.height / displayRatio.width + 48))
        window.center()
        window.standardWindowButton(.closeButton)?.toolTip = "close this window · follow the automation setting"
        let web = WKWebView()
        web.navigationDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: desktopBar!.topAnchor)
        ])
        self.window = window
        self.webView = web
    }

    func windowWillResize(_ sender: NSWindow, to frameSize: NSSize) -> NSSize {
        guard sender === window else { return frameSize }
        let chrome = sender.frame.height - sender.contentLayoutRect.height
        return NSSize(width: frameSize.width, height: frameSize.width * 1000 / 1440 + 48 + chrome)
    }

    @objc func finish() {
        guard !opening else { return }
        if selectedWorkspace == "shared", mode == "human" { closeBrowserViewer(); return }
        opening = true
        controlButton?.isEnabled = false
        request(mode == "human" ? "/release-control" : "/take-control", post: true, arguments: ["name": selectedWorkspace]) { result in
            self.opening = false
            self.updateAutomationControl()
            switch result {
            case .failure(let error): self.showError(error.localizedDescription)
            case .success(let status):
                self.mode = status["mode"] as? String ?? self.mode
                self.viewerOpen = true
                self.updateAutomationControl()
                self.webView?.evaluateJavaScript("window.refreshOwnership?.()")
                self.refreshBrowserWindows()
                self.updateMenu()
            }
        }
    }
    @objc func hideBrowser() { closeBrowserViewer() }

    func closeBrowserViewer() {
        request("/close-viewer", post: true) { result in
            switch result {
            case .failure(let error): self.showError(error.localizedDescription)
            case .success(let status):
                self.mode = status["mode"] as? String ?? self.mode
                self.automationPaused = status["automationPaused"] as? Bool ?? false
                self.viewerOpen = false
                self.hideWindow()
                self.updateMenu()
                if self.mode == "paused" { self.schedulePauseTip(force: true) }
                self.poll()
            }
        }
    }

    func hideWindow() {
        webView?.loadHTMLString("", baseURL: nil)
        window?.orderOut(nil)
        updateWindowMode()
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === setupWindow { closeSetup(); return false }
        hideBrowser(); return false
    }

    func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "igor vm"
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

    @objc func configureServer() {
        prepareVisibleInterface()
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "connect to a server"
        alert.informativeText = "use the same computer locally or on another host. remote connections require https."
        alert.addButton(withTitle: "connect")
        alert.addButton(withTitle: "cancel")
        let fields = NSStackView()
        fields.orientation = .vertical; fields.alignment = .leading; fields.spacing = 8
        fields.addArrangedSubview(NSTextField(labelWithString: "server url"))
        let address = NSTextField(string: origin)
        address.widthAnchor.constraint(equalToConstant: 360).isActive = true
        fields.addArrangedSubview(address)
        fields.addArrangedSubview(NSTextField(labelWithString: "credential file · leave empty for local server"))
        let credential = NSTextField(string: UserDefaults.standard.string(forKey: "serverTokenFile") ?? "")
        credential.widthAnchor.constraint(equalToConstant: 360).isActive = true
        fields.addArrangedSubview(credential)
        fields.frame = NSRect(x: 0, y: 0, width: 360, height: 116)
        alert.accessoryView = fields
        guard alert.runModal() == .alertFirstButtonReturn else { updateWindowMode(); return }
        let value = address.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: value), (url.scheme == "https" || (url.scheme == "http" && url.host == "127.0.0.1")),
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/" else {
            let error = NSAlert(); error.messageText = "invalid server url"; error.informativeText = "use an https origin, or http://127.0.0.1:18420 for the local server."; error.runModal(); return
        }
        if mode == "human" { let error = NSAlert(); error.messageText = "finish using this computer first"; error.runModal(); return }
        UserDefaults.standard.set(value.hasSuffix("/") ? String(value.dropLast()) : value, forKey: "serverOrigin")
        let file = credential.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if file.isEmpty { UserDefaults.standard.removeObject(forKey: "serverTokenFile") }
        else { UserDefaults.standard.set((file as NSString).expandingTildeInPath, forKey: "serverTokenFile") }
        startupError = nil; runtimeReady = false; mode = "starting"; lastRequest = nil
        poll(); showSetup()
    }

    @objc func quit() {
        guard !quitting else { return }
        quitting = true
        let finish = {
            self.shutdownComplete = true
            if self.terminationPending { NSApp.reply(toApplicationShouldTerminate: true) }
            else { NSApp.terminate(nil) }
        }
        // Viewer exit follows its automation toggle. Server and VM stay independent.
        if viewerOpen || mode == "human" {
            request("/close-viewer", post: true) { result in
                if case .failure(let error) = result {
                    self.quitting = false
                    if self.terminationPending { self.terminationPending = false; NSApp.reply(toApplicationShouldTerminate: false) }
                    let alert = NSAlert(); alert.messageText = "could not return control"; alert.informativeText = error.localizedDescription; alert.runModal()
                    return
                }
                finish()
            }
        } else { finish() }
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

import AppKit
import WebKit
import UserNotifications
import ServiceManagement

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
    let origin = "http://127.0.0.1:18420"
    var token: String? {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Igor Browser/token")
        return try? String(contentsOf: url, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "globe", accessibilityDescription: "Igor Browser")
        UNUserNotificationCenter.current().delegate = self
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.poll() }
        updateMenu()
        if CommandLine.arguments.contains("--enable-login") && SMAppService.mainApp.status == .notRegistered {
            do { try SMAppService.mainApp.register() } catch { NSLog("Login registration failed: %@", error.localizedDescription) }
        }
        poll()
        if CommandLine.arguments.contains("--show") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.showBrowser() }
        }
    }

    func startService() {
        guard worker?.isRunning != true,
              let script = Bundle.main.url(forResource: "run-service", withExtension: "sh") else { return }
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
        do { try process.run(); worker = process } catch { helpMessage = error.localizedDescription }
    }

    func request(_ path: String, post: Bool = false, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard let token = token else {
            completion(.failure(NSError(domain: "IgorBrowser", code: 1, userInfo: [NSLocalizedDescriptionKey: "Browser service is starting."])))
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
                    completion(.failure(NSError(domain: "IgorBrowser", code: 2, userInfo: [NSLocalizedDescriptionKey: object["error"] as? String ?? "Browser unavailable."])))
                } else { completion(.success(object)) }
            }
        }.resume()
    }

    func poll() {
        request("/status") { result in
            switch result {
            case .failure:
                self.mode = "starting"
                self.startService()
            case .success(let status):
                let previousMode = self.mode
                self.mode = status["mode"] as? String ?? "agent"
                if previousMode == "human" && self.mode != "human" { self.hideWindow() }
                if self.mode == "pending", let request = status["request"] as? [String: Any],
                   let id = request["id"] as? String, self.lastRequest != id {
                    self.lastRequest = id
                    self.helpMessage = request["message"] as? String ?? "Your AI needs your help."
                    let content = UNMutableNotificationContent()
                    content.title = "Igor Browser needs your help"
                    content.body = self.helpMessage
                    content.sound = nil
                    UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
                }
            }
            self.updateMenu()
        }
    }

    func updateMenu() {
        let menu = NSMenu()
        let state = ["agent": "Browser ready", "pending": "Your help is needed", "human": "You have control", "paused": "Browser paused", "starting": "Starting browser…"][mode] ?? mode
        menu.addItem(withTitle: state, action: nil, keyEquivalent: "")
        if mode == "pending" { menu.addItem(withTitle: helpMessage, action: nil, keyEquivalent: "") }
        menu.addItem(.separator())
        menu.addItem(withTitle: "Show Browser", action: #selector(showBrowser), keyEquivalent: "")
        menu.addItem(withTitle: "Enable Help Notifications…", action: #selector(enableNotifications), keyEquivalent: "")
        let loginEnabled = SMAppService.mainApp.status == .enabled
        menu.addItem(withTitle: loginEnabled ? "Disable Start at Login" : "Start at Login", action: #selector(toggleLogin), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Igor Browser", action: #selector(quit), keyEquivalent: "q")
        for entry in menu.items where entry.action != nil { entry.target = self }
        item.menu = menu
        item.button?.image = NSImage(systemSymbolName: mode == "pending" ? "exclamationmark.bubble" : "globe", accessibilityDescription: state)
        item.button?.toolTip = state
    }

    @objc func enableNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { _, _ in }
    }

    @objc func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch { showError(error.localizedDescription) }
        updateMenu()
    }

    @objc func showBrowser() {
        guard !opening else { return }
        opening = true
        request("/take-control", post: true) { result in
            self.opening = false
            switch result {
            case .failure(let error): self.showError(error.localizedDescription)
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
        window.title = "Igor Browser — You have control"
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("IgorBrowserViewer")
        window.center()
        let view = NSView()
        window.contentView = view
        let label = NSTextField(labelWithString: "Automation is paused while you use this browser.")
        let done = NSButton(title: "Done — Return to Agent", target: self, action: #selector(finish))
        done.bezelStyle = .rounded
        let hide = NSButton(title: "Hide — Keep Paused", target: self, action: #selector(hideBrowser))
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

    func windowShouldClose(_ sender: NSWindow) -> Bool { hideBrowser(); return false }

    func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Igor Browser"
        alert.informativeText = message
        alert.runModal()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        decisionHandler(url?.host == "127.0.0.1" && url?.port == 18420 || url?.absoluteString == "about:blank" ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        webView.loadHTMLString("<p>Could not open the browser display. Check that the service is running.</p>", baseURL: nil)
        NSLog("Viewer navigation failed: %@", error.localizedDescription)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { self.showBrowser(); completionHandler() }
    }

    @objc func quit() {
        request("/cancel", post: true) { _ in
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

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()

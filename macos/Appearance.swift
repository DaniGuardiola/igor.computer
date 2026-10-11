import AppKit

class AppearanceSurface: NSView {
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        effectiveAppearance.performAsCurrentDrawingAppearance {
            layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        }
    }
}

class AppearanceCard: NSStackView {
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        effectiveAppearance.performAsCurrentDrawingAppearance {
            layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
            layer?.borderColor = NSColor.separatorColor.cgColor
        }
    }
}

extension AppDelegate {
    func applyNativeAppearance() {
        NSApp.appearance = appearanceMode == "system" ? nil : NSAppearance(named: appearanceMode == "dark" ? .darkAqua : .aqua)
        appearancePicker?.selectedSegment = ["system", "light", "dark"].firstIndex(of: appearanceMode) ?? 0
    }

    @objc func changeAppearance(_ sender: NSSegmentedControl) {
        let choices = ["system", "light", "dark"]
        guard choices.indices.contains(sender.selectedSegment) else { return }
        appearanceMode = choices[sender.selectedSegment]
        UserDefaults.standard.set(appearanceMode, forKey: "appearanceMode")
        applyNativeAppearance()
        appearanceSignature = ""
        syncAppearance(nil)
    }

    func syncAppearance(_ server: [String: Any]?) {
        applyNativeAppearance()
        let hostDark = UserDefaults.standard.string(forKey: "AppleInterfaceStyle") == "Dark"
        let signature = appearanceMode + ":" + String(hostDark)
        let serverMatches = server?["mode"] as? String == appearanceMode && server?["hostDark"] as? Bool == hostDark
        guard !appearanceSyncing, signature != appearanceSignature || !serverMatches else { return }
        appearanceSyncing = true
        request("/appearance", post: true, arguments: ["mode": appearanceMode, "hostDark": hostDark]) { result in
            self.appearanceSyncing = false
            switch result {
            case .success:
                self.appearanceError = nil
                self.appearanceSignature = signature
                self.webView?.evaluateJavaScript("window.refreshOwnership?.()")
            case .failure(let error): self.appearanceError = error.localizedDescription
            }
            self.renderSetup()
            self.appearancePicker?.toolTip = self.appearanceError ?? "system follows your Mac's appearance"
        }
    }
}

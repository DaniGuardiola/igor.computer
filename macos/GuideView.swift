import SwiftUI
import AppKit

enum GuidePointerSide { case none, left, right }

final class GuideAppearance: ObservableObject {
    @Published var side: GuidePointerSide = .none
    @Published var pointerY: CGFloat = 66
    @Published var targeted = false
    @Published var notificationStep: NotificationGuideStep = .allow
}

// A continuous outline keeps the material, border, and pointer seamless.
struct GuideBubble: Shape {
    var side: GuidePointerSide
    var pointerY: CGFloat

    func path(in rect: CGRect) -> Path {
        let left: CGFloat = side == .left ? 12 : 0
        let right = rect.width - (side == .right ? 12 : 0)
        let bottom = rect.height
        let radius: CGFloat = 18
        let y = min(bottom - 25, max(25, bottom - pointerY))
        var p = Path()
        p.move(to: CGPoint(x: left + radius, y: 0))
        p.addLine(to: CGPoint(x: right - radius, y: 0))
        p.addQuadCurve(to: CGPoint(x: right, y: radius), control: CGPoint(x: right, y: 0))
        if side == .right {
            p.addLine(to: CGPoint(x: right, y: y - 9))
            p.addLine(to: CGPoint(x: rect.width, y: y))
            p.addLine(to: CGPoint(x: right, y: y + 9))
        }
        p.addLine(to: CGPoint(x: right, y: bottom - radius))
        p.addQuadCurve(to: CGPoint(x: right - radius, y: bottom), control: CGPoint(x: right, y: bottom))
        p.addLine(to: CGPoint(x: left + radius, y: bottom))
        p.addQuadCurve(to: CGPoint(x: left, y: bottom - radius), control: CGPoint(x: left, y: bottom))
        if side == .left {
            p.addLine(to: CGPoint(x: left, y: y + 9))
            p.addLine(to: CGPoint(x: 0, y: y))
            p.addLine(to: CGPoint(x: left, y: y - 9))
        }
        p.addLine(to: CGPoint(x: left, y: radius))
        p.addQuadCurve(to: CGPoint(x: left + radius, y: 0), control: CGPoint(x: left, y: 0))
        p.closeSubpath()
        return p
    }
}

struct GuideView: View {
    let kind: String
    @ObservedObject var appearance: GuideAppearance

    var body: some View {
        let shape = GuideBubble(side: appearance.side, pointerY: appearance.pointerY)
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: kind == "login" ? "power" : "bell.fill")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 32, height: 32)
                    .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 3) {
                    Text(kind == "login" ? "start at login" : appearance.notificationStep.title)
                        .font(.system(size: 14, weight: .semibold))
                    Text("igor browser").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
            }
            Text(instruction)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .padding(.leading, appearance.side == .left ? 12 : 0)
        .padding(.trailing, appearance.side == .right ? 12 : 0)
        .frame(width: 330, height: 132, alignment: .topLeading)
        .background(.ultraThinMaterial, in: shape)
        .overlay(shape.stroke(.primary.opacity(0.14), lineWidth: 1))
    }

    private var instruction: String {
        if kind == "login" {
            return appearance.targeted ? "turn this on to keep your agent's browser available after login." : "turn on igor browser in login items to keep it available for your agent."
        }
        return appearance.notificationStep.instruction
    }
}

struct GuidePlacement {
    let frame: CGRect
    let side: GuidePointerSide
    let pointerY: CGFloat

    static func besideWindow(_ window: CGRect, pointingAt target: CGRect, size: CGSize, visible: CGRect) -> GuidePlacement? {
        // Use the window edges for every step so the panel never covers nearby controls.
        let row = CGRect(x: window.minX, y: target.minY, width: window.width, height: target.height)
        return nextTo(row, size: size, visible: visible)
    }

    static func nextTo(_ target: CGRect, size: CGSize, visible: CGRect) -> GuidePlacement? {
        guard visible.contains(target), size.width <= visible.width, size.height <= visible.height else { return nil }
        let gap: CGFloat = 14
        let x: CGFloat
        let side: GuidePointerSide
        if target.maxX + gap + size.width <= visible.maxX {
            x = target.maxX + gap; side = .left
        } else if target.minX - gap - size.width >= visible.minX {
            x = target.minX - gap - size.width; side = .right
        } else { return nil }
        let y = max(visible.minY, min(target.midY - size.height / 2, visible.maxY - size.height))
        let pointerY = target.midY - y
        guard pointerY >= 25, pointerY <= size.height - 25 else { return nil }
        return .init(frame: CGRect(origin: CGPoint(x: x, y: y), size: size), side: side, pointerY: pointerY)
    }
}

// Default macOS 26+ app-notification layout, measured in window coordinates.
// Estimates are visual guidance only; notification readiness uses native APIs.
enum GuideEstimate {
    static func notification(_ step: NotificationGuideStep, in window: CGRect) -> CGRect? {
        guard window.width >= 650, window.width <= 1000, window.height >= 430 else { return nil }
        let top: CGFloat
        let x: CGFloat
        let size: CGSize
        switch step {
        case .allow:
            top = 73; size = CGSize(width: 44, height: 20)
            x = window.maxX - 30 - size.width
        case .desktop, .notificationCenter:
            top = 146; size = CGSize(width: step == .desktop ? 88 : 107, height: 105)
            let contentWidth = window.width - 230
            let fraction: CGFloat = step == .desktop ? 119 / 510 : 256 / 510
            x = window.minX + 230 + contentWidth * fraction - size.width / 2
        case .persistent:
            top = 282; size = CGSize(width: 82, height: 16)
            x = window.maxX - 30 - size.width
        case .ready: return nil
        }
        // Window tracker applies a -3pt decoration adjustment.
        return CGRect(x: x, y: window.maxY + 3 - top - size.height, width: size.width, height: size.height)
    }
}

// Wait for the opening transition and window geometry to settle before revealing.
enum GuidePresentation {
    static func canReveal(settingsForeground: Bool, elapsed: TimeInterval, stableFor: TimeInterval) -> Bool {
        settingsForeground && elapsed >= 0.2 && stableFor >= 0.12
    }
}

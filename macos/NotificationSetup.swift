enum NotificationGuideStep: Equatable {
    case allow, desktop, persistent, ready

    static func current(allowed: Bool, desktop: Bool, style: String) -> Self {
        if !allowed { return .allow }
        if !desktop { return .desktop }
        return style == "temporary" ? .persistent : .ready
    }

    var title: String {
        switch self {
        case .allow: return "allow notifications"
        case .desktop: return "show on desktop"
        case .persistent: return "keep requests visible"
        case .ready: return "notifications ready"
        }
    }
    var instruction: String {
        switch self {
        case .allow: return "turn on allow notifications so your agent can ask for help."
        case .desktop: return "enable desktop so help requests appear onscreen."
        case .persistent: return "persistent keeps requests visible until dismissed. temporary works too."
        case .ready: return "your agent can ask for help without opening a window."
        }
    }
    var targetIdentifier: String? {
        switch self {
        case .allow: return "allow-notifications"
        // System Settings currently exposes this misspelled accessibility identifier.
        case .desktop: return "notification-presence-dektop"
        default: return nil
        }
    }
}

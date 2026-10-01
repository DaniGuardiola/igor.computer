import AppKit
@main struct StateCheck {
 static func main() {
  var foreground = SettingsReturnState()
  assert(foreground.observe(hasWindow: false, settingsIsForeground: false) == nil)
  assert(foreground.observe(hasWindow: true, settingsIsForeground: true) == nil)
  assert(foreground.observe(hasWindow: false, settingsIsForeground: false) == true)
  var background = SettingsReturnState()
  assert(background.observe(hasWindow: true, settingsIsForeground: true) == nil)
  assert(background.observe(hasWindow: true, settingsIsForeground: false) == nil)
  assert(background.observe(hasWindow: false, settingsIsForeground: false) == false)
  var spaceSwitch = SettingsReturnState()
  assert(spaceSwitch.observe(hasWindow: true, settingsIsForeground: true) == nil)
  assert(spaceSwitch.observe(hasWindow: true, settingsIsForeground: false) == nil)
  assert(NotificationGuideStep.current(allowed: false, desktop: false, style: "off") == .allow)
  assert(NotificationGuideStep.current(allowed: true, desktop: false, style: "temporary") == .desktop)
  assert(NotificationGuideStep.current(allowed: true, desktop: true, style: "temporary") == .persistent)
  assert(NotificationGuideStep.current(allowed: true, desktop: true, style: "persistent") == .ready)
  assert(NotificationGuideStep.current(allowed: true, desktop: true, notificationCenter: false, style: "persistent") == .notificationCenter)
  assert(NotificationGuideStep.current(allowed: true, desktop: false, notificationCenter: true, style: "persistent") == .desktop)
  assert(NotificationGuideStep.current(allowed: false, desktop: true, notificationCenter: true, style: "persistent") == .allow)
  assert(NotificationGuideStep.current(allowed: true, desktop: true, notificationCenter: true, style: "temporary") == .persistent)
  assert(SettingsCompletionPolicy.shouldClose(initiated: true, windowCount: 1, foreground: true))
  assert(!SettingsCompletionPolicy.shouldClose(initiated: false, windowCount: 1, foreground: true))
  assert(!SettingsCompletionPolicy.shouldClose(initiated: true, windowCount: 2, foreground: true))
  assert(!SettingsCompletionPolicy.shouldClose(initiated: true, windowCount: nil, foreground: true))
  assert(!SettingsCompletionPolicy.shouldClose(initiated: true, windowCount: 1, foreground: false))
  print("PASS: revocations return to missing steps; completion preserves pre-existing Settings.")
  print("PASS: notification guidance advances through permission, desktop, and optional persistent style.")
  let screen = CGRect(x: 0, y: 0, width: 1000, height: 800)
  let size = CGSize(width: 330, height: 132)
  let toggle = CGRect(x: 500, y: 400, width: 44, height: 20)
  let right = GuidePlacement.nextTo(toggle, size: size, visible: screen)!
  assert(right.side == .left)
  assert(!right.frame.intersects(toggle))
  assert(screen.contains(right.frame))
  assert(abs(right.frame.minY + right.pointerY - toggle.midY) < 1)
  let edgeToggle = CGRect(x: 950, y: 400, width: 44, height: 20)
  let left = GuidePlacement.nextTo(edgeToggle, size: size, visible: screen)!
  assert(left.side == .right)
  assert(!left.frame.intersects(edgeToggle))
  assert(screen.contains(left.frame))
  let settingsWindow = CGRect(x: 350, y: 150, width: 260, height: 480)
  let fallback = GuidePlacement.nextTo(settingsWindow, size: size, visible: screen)!
  assert(fallback.side == .left)
  assert(!fallback.frame.intersects(settingsWindow))
  assert(abs(fallback.frame.minY + fallback.pointerY - settingsWindow.midY) < 1)
  let defaultWindow = CGRect(x: 100, y: 100, width: 740, height: 625)
  for step: NotificationGuideStep in [.allow, .desktop, .notificationCenter, .persistent] {
   let estimate = GuideEstimate.notification(step, in: defaultWindow)!
   assert(defaultWindow.contains(estimate))
   let moved = GuideEstimate.notification(step, in: defaultWindow.offsetBy(dx: 120, dy: -40))!
   assert(moved == estimate.offsetBy(dx: 120, dy: -40))
   let placement = GuidePlacement.nextTo(estimate, size: size, visible: screen)!
   assert(!placement.frame.intersects(estimate))
   assert(abs(placement.frame.minY + placement.pointerY - estimate.midY) < 1)
  }
  assert(abs(GuideEstimate.notification(.desktop, in: defaultWindow)!.minX - (defaultWindow.minX + 305)) < 1)
  assert(GuideEstimate.notification(.ready, in: defaultWindow) == nil)
  assert(GuideEstimate.notification(.allow, in: CGRect(x: 0, y: 0, width: 400, height: 400)) == nil)
  print("PASS: estimated controls track window movement without covering the control.")
  let narrow = CGRect(x: 0, y: 0, width: 320, height: 800)
  assert(GuidePlacement.nextTo(toggle, size: size, visible: narrow) == nil)
  let bottomToggle = CGRect(x: 500, y: 0, width: 44, height: 20)
  assert(GuidePlacement.nextTo(bottomToggle, size: size, visible: screen) == nil)
  print("PASS: pointer alignment, unobstructed toggle, edge flipping, and constrained-screen fallback.")
  print("PASS: foreground close returns focus; background close and desktop switches do not.")
 }
}

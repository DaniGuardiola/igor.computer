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
  print("PASS: foreground close returns focus; background close and desktop switches do not.")
 }
}

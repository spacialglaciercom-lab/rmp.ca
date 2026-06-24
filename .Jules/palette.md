## 2025-05-15 - [Accessible Map Controls]
**Learning:** Icon-only buttons on maps (like Zoom In/Out) are often missed by screen readers if they only contain text symbols (+/-). Providing explicit accessibility labels and roles makes these essential navigation tools usable for all users.
**Action:** Always add accessibilityLabel, accessibilityRole="button", and accessibilityHint to custom interactive components that don't use standard platform buttons.

---
kind: upgrade-guide
description: "Browser, Computer Use, and Security Research ship ready to use without Settings pages."
---

# Capability settings pages removed

English | [中文](guide.zh.md)

## Change

The Settings navigation keeps one capability page: Mobile Emulator. Security Research, the browser, and Computer Use no longer have Settings pages, because their providers now ship switched on in the Web product composition.

The Web profile mounts @deepseek-ai/dsh-cinlan-browser and @deepseek-ai/dsh-cinlan-computer-use, and @deepseek-ai/dsh-web-capability-defaults enables browser-playwright and computer-use-cua-driver-native instead of disabling them. Approval policies are unchanged: browser observe, navigate, and interact still ask, and native Computer Use still asks.

The packaged security-research Agent preset is built in. It enters the preset roster whenever the security-research bundle mounts, independent of installed skill resources, and sits directly after PTC mode in the built-in group.

The client package @deepseek-ai/dsh-client-ui-settings-security now renders only the Mobile Emulator page: it probes the device provider, edits the SDK path and default device, lists the mobile tools, and manages Android runtime resources.

## Migration

1. Restart the Web profile once so the composition change applies.
2. Add @deepseek-ai/dsh-cinlan-computer-use to an existing profile's bundle list to obtain the native desktop provider; the shipped template includes it for new profiles.
3. Read browser preferences from the browser-playwright Config row in the profile patch instead of the removed Browser page.
4. Select the 安全研究 preset from Agent presets to run security work; installing skill resources only widens its skill catalog.
5. Use the Plugin Manager to switch a provider off when a deployment must not expose it.

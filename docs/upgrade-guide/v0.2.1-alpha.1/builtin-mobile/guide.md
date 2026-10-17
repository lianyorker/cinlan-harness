---
kind: upgrade-guide
description: "Web and Desktop include Mobile Device, and mobile preferences use live profile Config."
---

# Built-in mobile settings

English | [中文](guide.zh.md)

## Change

Web and Desktop include `@deepseek-ai/dsh-cinlan-mobile-device`, with native ADB discovery, Android resource management, and approval-gated model tools. Startup installs no SDK and opens no mirror. The stock Web bundle tuple from this release is normalized to the current template; custom bundle lists are preserved.

The `mobile-device` entry exposes `enabled`, `androidSdkPath`, and `defaultDeviceId` as volatile Config fields. Settings writes the profile's `cordis.patch.yml`; runtime readers consume those live values rather than the removed Settings document. `enabled` is a checking preference, not device authorization. Resource and mirror controller calls require the Connection operator's Remote invocation; direct calls without that identity are refused.

## Migration

1. Restart the stock Web profile. For an existing customized Web or Desktop profile, include `@deepseek-ai/dsh-cinlan-mobile-device` exactly once in `dsh.profile.bundles` in its `package.json`; keep any existing entry instead of adding a duplicate.
2. Remove hand-inserted mobile entries duplicated by the bundle. Keep deployment changes as id-targeted patches; a `mobile-device` Config override must retain `provider: adb` when selecting that Provider.
3. In Settings, open Mobile Emulator and select the SDK directory, or enter it and leave the field to save. Confirm the value remains after reopening the page and appears under the `mobile-device` Config in the profile patch. Existing legacy Settings values are imported by Settings when this entry is active.
4. Call resource and mirror Remotes through the authenticated Gateway. Host integrations that need direct management use `ctx.mobileRuntime` instead of invoking controller methods without a Remote identity.

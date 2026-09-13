# Local device control

English | [中文](device-control.zh.md)

## Prerequisites

Use a build that includes the device-control profile. Desktop control requires a compatible Orca CLI with the version-1 computer protocol. Mobile control requires its device protocol and an available emulator, simulator, or device. The Harness bundle does not install Orca, platform permissions, or device images.

## Start an isolated profile

Inspect the composition without opening a device or making a model request:

```sh
dsh --profile device-control --dump-config
```

Start its Web interface:

```sh
dsh --profile device-control
```

The profile uses the normal dsh launcher and contains Computer Use and Mobile Device bundles. Plain web and headless profiles are unchanged. For a source checkout, use `pnpm dsh` in place of `dsh` after building.

## Configure the executable

Provider rows accept a `command` executable name or absolute path. The default is `orca`, or `orca-ide` on Linux. Set this field in the profile's cordis.patch.yml if the executable is not on PATH. Keep the existing providerId when overriding the row's complete config. The package READMEs document every timeout and size limit: [Computer Use](../../../../packages/computer-use/computer-use-cinlan/README.md) and [Mobile Device](../../../../packages/mobile-device/mobile-device-cinlan/README.md).

## Verify readiness

Open Settings → Computer use or Mobile device. Check again performs a read-only Host probe. Not enabled means the capability is absent from the active profile; Provider unavailable reports a missing CLI, incompatible response, unavailable Provider, or missing mobile devices. Provider connected does not grant permission to send input.

All observation and input classes request approval by default. Observe before acting, use only the current observation identifiers, and verify the resulting state. The command shown in Settings launches a profile; it is not an installer.

## Limits

This guide does not claim that a passing fixture proves real platform automation. Validate the external CLI, OS permissions, application focus, and emulator state on the target desktop before using input tools. [Device control](../../../subsystems/device-control.md) documents readiness and lifecycle semantics.

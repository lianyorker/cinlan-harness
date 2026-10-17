# `@deepseek-ai/dsh-cinlan-remote-tunnel`

This Host plugin owns the authenticated mobile listener and the optional reverse connection to a self-hosted Director/Cell deployment. It is loaded by the `cinlan-mobile-host` profile row and is not a replacement for the loopback Connection operator API.

Host settings select one mode: `local` binds to loopback, `lan` binds to the selected local address, and `relay` resolves a signed regional lease through the configured Director. Pairing tickets expire and are consumed once. Device credentials are stored as digests; revoke removes the device from the Host and relay and closes its active sockets.

Keep `stateFile` private and set `mobileAssetsDir` explicitly when the application is installed outside the repository layout. Use HTTPS for remote Director URLs unless a development LAN explicitly enables `allowInsecureNetwork`.

---
kind: implemented-note
---

# Cinlan mobile connection

English | [中文](2026-10-09-cinlan-mobile-connection.zh.md)

The mobile companion uses a versioned Host protocol with one direct (`local` or `lan`) or self-hosted `relay` transport selected in Host settings. Pairing offers contain an expiring single-use ticket and a pinned Host public key; successful enrollment persists only credential digests on the Host and creates an independent saved mobile connection.

The relay runtime separates Director assignment from Cell forwarding. Directors issue signed regional leases, Cells enforce host/device admission, capacity, queue and payload limits, and relay sockets forward opaque encrypted frames. Host revoke closes active device sockets and removes the Cell credential. Lease renewal keeps the same region and epoch; a changed or unavailable assignment closes the generation so the Host reconnect policy can obtain a fresh assignment.

The mobile UI projects real Host desktop, workspace, session, stream and approval events. Create, prompt, subscribe and approval commands return Host errors to the UI. Prototype settings pages and controls that do not have a backend are disabled instead of reporting successful mock operations.

The handshake binds both public keys, nonces, Host identity, transport direction and context. It provides replay and expiry checks but does not claim complete forward secrecy or equivalence to Orca; Host state files and browser storage remain deployment secrets.

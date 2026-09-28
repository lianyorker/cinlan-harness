# Agent Note: Gateway complete-output limits terminate carriers

Status: implemented

English | [中文](2026-09-25-gateway-complete-output-limit-teardown.zh.md)

## Problem

Delegated unary responses and Remote stream frames can contain attacker-controlled or unexpectedly large JSON values. A limit that measures only the application value can still emit an oversized serialized envelope, and a graceful WebSocket close can leave active iterators waiting when the peer does not complete the close handshake.

## Decision

Connection serializes the complete unary response envelope before emission and counts its UTF-8 bytes with Buffer.byteLength(text, 'utf8'). A delegated response above maxResponseBytes is replaced by a bounded 413 response; a response at the exact limit remains valid. The cap applies to success and error envelopes, including handler-failure text.

Gateway serializes each complete Remote frame, including its type, stream id, and value or error fields, before sending it. A frame above maxOutputBytes is rejected before send; the mux terminates the physical WebSocket and aborts every active logical stream instead of waiting for a peer close handshake. A frame at the exact UTF-8 limit remains valid.

Remote Access supplies its validated maxResponseBodyBytes setting to both the unary delegated carrier and the WebSocket mux. The readiness lifecycle remains separate: Gateway registers and disposes the carrier through its effect-owned route, as recorded in the [readiness note](2026-09-23-gateway-waits-for-application-readiness.md).

## Alternatives considered

**Count only the returned value or frame payload.** This leaves wrappers and metadata outside the bound, so the transmitted response can exceed the configured limit.

**Truncate an oversized JSON result.** Truncation produces invalid or semantically different protocol data and hides the owning operation's failure; rejecting before emission preserves a complete protocol message.

**Use a graceful close for output overflow.** A peer can stop responding to the close handshake while active iterators remain pending; termination gives the Host a bounded physical teardown and the abort signal releases stream-owned work.

## Consequences

Delegated callers receive a bounded transport error instead of an oversized response, while WebSocket peers observe physical termination rather than a guaranteed 1009 close frame for an overflow. Producers must honor the abort signal when an output limit terminates their carrier. Complete serialized output, UTF-8 encoding, and wrapper fields are part of the enforced limit.

## Testing

Gateway tests cover multibyte oversized frames, exact-limit frames, write failures, and termination of an unresponsive peer with another active iterator. Connection tests cover multibyte oversized success and error responses and an exact-limit complete envelope. Focused Loader composition runs exercise the real Connection registration path.

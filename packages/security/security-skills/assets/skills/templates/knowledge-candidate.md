# Cinlan Security Knowledge Candidate

English | [中文](knowledge-candidate.zh.md)

> Status: pending review
> Date: YYYY-MM-DD
> Routed skill: `<skill-name>`
> Proposed product destination: `kb/<topic>.md`, `<skill>/references/<topic>.md`, or `<skill>/SKILL.md`

Create this record only for a verified, reusable increment that the matching bundled KB does not cover. When instantiating the template, omit the language switcher above. Start with `<workspace>/.agents/field-journal/cyber-security/YYYY-MM-DD_<slug>.md`; if it exists, append `_HHmmssZ` using UTC and then the smallest unused numeric suffix. Never replace an existing candidate. Do not copy credentials, cookies, personal data, real target identifiers, private source, raw requests or responses, proprietary binaries, or other sensitive evidence into this file.

## Reusable signal

<!-- State the new observable signal and why it generalizes beyond one task. -->

## Preconditions and tested versions

<!-- Record the relevant OS, runtime, tool, target format, and version constraints. -->

## Verified method

<!-- Give the smallest reproducible procedure. Separate required steps from optional diagnostics. -->

## Evidence

<!-- Cite sanitized commands, stable error codes, public fixtures, or artifact hashes. State where private evidence remains instead of embedding it. -->

## Failure modes and limits

<!-- State negative cases, unsupported variants, confidence, and anything not verified. -->

## Existing coverage check

- Matching bundled KB or reference files checked:
- Why the existing guidance is insufficient:
- Related workspace candidates checked:

## Redaction and promotion checklist

Replace sensitive values with descriptive placeholders that preserve exploitation context:

| Sensitive value | Placeholder |
| --- | --- |
| Target / victim IPs | `{target_ip}`, `{victim_ip}`, `{remote_host}` |
| Domains | `{target_domain}`, `{callback_domain}` |
| Credentials | `{username}`, `{password}`, `{hash}` |
| Tokens / keys | `{token}`, `{api_key}` |
| Non-standard ports | `{port}` (preserve standard ports like 80/443) |
| Endpoints / callback URLs | `{api_endpoint}`, `{callback_url}` |
| Paths | `{install_dir}`, `{config_path}` |

- [ ] The method was executed successfully, not inferred from an untested proposal.
- [ ] The record contains no credential, personal data, real target identifier, private source, or raw sensitive evidence.
- [ ] Environment and version constraints are explicit.
- [ ] Existing product guidance and workspace candidates were checked for duplication.
- [ ] The proposed product destination and remaining review work are stated.

## Maintainer review

<!-- Maintainers record validation, deduplication, edits, and the promoted product path here. A candidate does not modify the installed bundle by itself. -->

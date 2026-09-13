# Knowledge Base AI Usage

English | [中文](AI-USAGE.zh.md)

`kb/` is the reviewed, read-only tactical library published with the product. It is not a per-case evidence directory, and an installed bundle must never be modified during a task.

## Reading

- Load only the files whose signals match the current task; do not inject the entire KB into model context.
- Use KB entries to guide reproducible commands, scripts, templates, and validation rather than treating prose as proof.
- Keep target-specific evidence in the task's `notes/`, `reports/`, or other authorized output directory.

## Learning candidates

After a completed security execution task, create a candidate only when the increment is verified, reusable across tasks, absent from the matching KB, and workspace writes are authorized. Instantiate the headings from `../templates/knowledge-candidate.md` without its language switcher and start with `<workspace>/.agents/field-journal/cyber-security/YYYY-MM-DD_<slug>.md`. If that path exists, append `_HHmmssZ` using UTC and then the smallest unused numeric suffix. Never replace an existing candidate.

The candidate must record prerequisites and tested versions, a reproducible method, sanitized evidence, failure modes, limits, the existing content checked, and a proposed product destination. Do not record routine task history, unverified ideas, credentials, personal data, real target identifiers, private source, raw requests or responses, proprietary binaries, or other sensitive evidence. Create no file when there is no valid increment; when the workspace cannot be written, report the candidate or `KB gap: [signal]` in the task result instead.

## Promotion

Users may manually copy or archive `.agents/field-journal/cyber-security/` for product review. Maintainers reproduce, sanitize, deduplicate, and edit accepted candidates in this package's source, then rebuild the package. A candidate never updates the installed bundle by itself.

## Current areas

- Web CTF: `kb/ctf-website/README.md`
- APK reverse engineering: `kb/apk-reverse/README.md`
- PE reverse engineering: `kb/pe-reverse/README.md`
- General security: `kb/general/README.md`
- CVE correlation graph: `kb/ctf-website/techniques/09-cve/cve-correlation-graph.md`

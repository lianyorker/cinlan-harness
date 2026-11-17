# @cinlan/client-ui-sidebar-git

English | [中文](README.zh.md)

Git review tab for the right Sidebar: repository changes, AI diff review and PR description drafts.

## What it adds

One right-Sidebar tab type (`git`) with a page body that:

- reads repository state, the selected change set (staged, worktree, or comparison), and the comparison base through the `sidebarGit` Remote namespace;
- starts one AI generation per action (`diff-review`, `pr-description`) through the `gitAi` Remote namespace, with cancel, busy, and timeout states;
- lands the draft in an editable textarea with copy and guarded regenerate (an edited draft asks before being replaced);
- drops late responses after the Session or selection changed, and notifies when the repository HEAD moved during generation.

Generated drafts are preview-only: this package never commits, pushes, or creates a pull request.

## Registration

- Registers the `git` tab type (with a guide entry) into `sidebarRightTabs`.
- Contributes `sidebar.right.pane.tab` (keyed `@cinlan/client-ui-sidebar-git`) with the body, and the matching `tab.title`.
- Declares the `sidebarGitReview` locale namespace (zh/en).

## Configuration

No plugin config. Generation behavior (enable, per-action recipes, diff budget, sensitive-file filtering) lives in the durable `git-source-control` settings namespace owned by `@cinlan/git-settings`; this package is a consumer.

## Known Limitations and Deferred Work

- The PR-description action always targets the comparison change set; the page switches the radio instead of offering per-action set selection.
- Copy uses `navigator.clipboard`; environments without the permission show the localized fallback.

## Model Experience

Reads no model state. The generation prompt is built Host-side by `@cinlan/git-ai-author`; see that package for token and KV-cache effects.

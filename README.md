# Cinlan Harness (星澜 Harness)

English | [中文](README.zh.md)

Cinlan Harness (`clh`) is an open-source agent harness developed and maintained by the Cinlan team, forked and evolved from DeepSeek Harness.

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), featuring complete namespace isolation, dual-command compatibility, and deep environment separation.

Documentation: [https://github.com/lianyorker/cinlan-harness](https://github.com/lianyorker/cinlan-harness)

## Developer preview

Cinlan Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Key features & isolation

- **Dual-Command CLI**: Primary command `clh` (`cinlan-harness`), with full compatibility for `dsh`.
- **Isolated User Home**: Defaults to `~/.clh` with caching in `~/.clh/cache` to prevent conflict with upstream configurations.
- **Hierarchical Environments**: Precedence order `CLH_HOME` -> `CINLAN_HARNESS_HOME` -> `DSH_HOME` -> `~/.clh`.
- **Process & Socket Isolation**: Dedicated `clh-` / `clh_` namespace for IPC sockets, PID locks, and sandbox temporary directories.

<a id="run"></a>

## Run

<a id="run-from-source"></a>

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/lianyorker/cinlan-harness.git
cd cinlan-harness
pnpm install
pnpm run build
pnpm clh web
```

`pnpm run build` prepares the repository artifacts. `pnpm clh web` starts the Web UI at `http://127.0.0.1:3080` by default and opens it in your default browser. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### CLI commands

Common commands supported by the `clh` launcher:

```sh
# Boot Web UI
pnpm clh web

# Run a headless agent task
pnpm clh headless "task description"

# Interactive TUI mode
pnpm clh tui

# Profile options and flags
pnpm clh --help
```

## Community and support

- Submit feedback or bug reports through [GitHub Issues and Discussions](https://github.com/lianyorker/cinlan-harness/issues).
- Fork and star on [GitHub](https://github.com/lianyorker/cinlan-harness).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

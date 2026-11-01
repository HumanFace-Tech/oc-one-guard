# Install oc-one-guard

Installation is explicit. Cloning, installing the package, or copying the repository does not register the plugin, edit OpenCode configuration, or create symlinks. You have to add the plugin entry yourself.

The package exports one entry point for both hosts. OpenCode 1.x uses the `server` entry; OpenCode 2.x uses `setup`. Version 1.19.4 is the tested v1 host, and the supported range is `>=1.19.4 <2`. OpenCode 2.2.x loads the plugin and registers its hooks, but its end-to-end tool-call tests are not complete. Older releases are unsupported. See [ADR 0011](adr/0011-opencode-v2-adapter.md).

## Install from npm on OpenCode 1.x

The package is published as [`oc-one-guard`](https://www.npmjs.com/package/oc-one-guard). Add it to the OpenCode configuration for one project:

```json
{
  "plugin": [
    [
      "oc-one-guard@0.2.0",
      {
        "endpoint": "http://127.0.0.1:8081/v1/systemone",
        "model": "h2o-lightning-4b"
      }
    ]
  ]
}
```

## Install from npm on OpenCode 2.x

OpenCode 2.x reads the `plugins` key. An object entry takes the same options:

```json
{
  "plugins": [
    {
      "package": "oc-one-guard@0.2.0",
      "options": {
        "endpoint": "http://127.0.0.1:8081/v1/systemone",
        "model": "h2o-lightning-4b"
      }
    }
  ]
}
```

Pin the version you reviewed. OpenCode installs npm plugins at startup and caches them, so an unpinned entry can pick up a newer release later. You do not need to run `npm install` in the project yourself.

For every project, use the same entry in the global OpenCode configuration instead. Restart OpenCode after editing, then [check that the plugin loaded](#verify-it-loaded). An entry that fails to load provides no protection.

To uninstall, stop OpenCode, remove the `oc-one-guard` entry from the applicable configuration, and restart. There is no separate uninstall command and no symlink to clean up.

## Verify it loaded

A failed plugin load does not stop OpenCode. OpenCode logs `failed to load plugin` and continues without the guard, so every tool call goes unreviewed. Check this after every install, upgrade, or config change.

On OpenCode 2.x, run the doctor script from the installed package. It starts a private server with `--standalone`, waits for plugin activation, and exits non-zero if the guard did not load:

```sh
OPENCODE_BIN=opencode node node_modules/oc-one-guard/bin/oc-one-guard-doctor
```

- Exit `0`: `oc-one-guard` was loaded and no load failure was logged.
- Exit `1`: the plugin failed to load or was never attempted. Fix the entry and run it again.
- Exit `2`: the check could not run (binary missing, or OpenCode did not finish plugin activation). Treat exit `1` and exit `2` alike: the guard is not confirmed active.

The doctor reads OpenCode's startup log. It does not inspect what the guard decides at runtime. Run it from the project where the plugin is configured, because OpenCode reads project and global config from the working directory.

On OpenCode 1.x, the startup log shows `Guard active` when the guard loads with a valid configuration. A configuration problem is logged as `Configuration problem`.

## Enable a local checkout

Keep the checkout in a stable directory, then add its absolute path to the OpenCode configuration for the project where you want the guard. The example sets the System One endpoint as an inline option:

```json
{
  "plugin": [
    ["/absolute/path/to/oc-one-guard", { "endpoint": "http://127.0.0.1:8081/v1/systemone" }]
  ]
}
```

On OpenCode 2.x use the `plugins` object form with `"package": "/absolute/path/to/oc-one-guard"`. Use a directory, not a file.

Project-level registration affects that project. Registration in the user's global OpenCode configuration affects all projects for that user, so use it only if that is what you want. Do not use a package name for this checkout.

After changing the plugin entry, restart OpenCode and [check that the plugin loaded](#verify-it-loaded). An entry that is missing or fails to load provides no protection.

## Disable it if the judge is offline

With the defaults, a judge request failure blocks a call that needs review. If the session is stuck, stop OpenCode outside its TUI, edit the applicable project or global configuration, and remove only the `oc-one-guard` entry. Start OpenCode again. Setting `enabled` to `false` does not disable the blocked-host scan; removing the registration is the full disable path.

## Configuration files and packages

For a copied source folder, `config.json` or `config.jsonc` beside the plugin source supplies settings unless inline options override them. These local files are ignored by Git and excluded from the npm package. `config.example.json` is included as a sample, but it is not an exact copy of built-in defaults.

The package has no runtime npm dependencies and does not require `@opencode-ai/plugin` or `@opencode/plugin`. An installed package should use inline options for non-default settings unless you maintain a local config beside its source; do not assume the package directory is writable.

See [configuration](configuration.md) for precedence and the full reference. For the host's plugin configuration format, see the [OpenCode plugin documentation](https://opencode.ai/docs/plugins/), noting it may describe versions newer than this plugin supports.

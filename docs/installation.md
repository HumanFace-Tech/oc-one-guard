# Install oc-one-guard

Installation is explicit. Cloning, installing the package, or copying the repository does not register the plugin, edit OpenCode configuration, or create symlinks. You have to add the plugin entry yourself.

This release supports OpenCode v1. Version 1.19.4 is tested, and the conservative supported range is `>=1.19.4 <2`; this is not a claim that every version in the range was tested. Older releases and v2 are unsupported.

## Install from npm

The package is published as [`oc-one-guard`](https://www.npmjs.com/package/oc-one-guard). Add it to the OpenCode configuration for one project:

```json
{
  "plugin": [
    [
      "oc-one-guard@0.1.1",
      {
        "endpoint": "http://127.0.0.1:8081/v1/systemone",
        "model": "h2o-lightning-4b"
      }
    ]
  ]
}
```

Pin the version you reviewed. OpenCode installs npm plugins with Bun at startup and caches them under `~/.cache/opencode/node_modules/`; an unpinned entry can pick up a newer release later. You do not need to run `npm install` in the project yourself.

For every project, use the same entry in the global OpenCode configuration instead. Restart OpenCode after editing, and check the startup log for `Guard active` or a configuration problem. An entry that fails to load provides no protection.

To uninstall, stop OpenCode, remove the `oc-one-guard` entry from the applicable configuration, and restart. There is no separate uninstall command and no symlink to clean up.

## Enable a local checkout

Keep the checkout in a stable directory, then add its absolute path to the OpenCode configuration for the project where you want the guard. The example sets the System One endpoint as an inline option:

```json
{
  "plugin": [
    ["/absolute/path/to/oc-one-guard", { "endpoint": "http://127.0.0.1:8081/v1/systemone" }]
  ]
}
```

Project-level registration affects that project. Registration in the user's global OpenCode configuration affects all projects for that user, so use it only if that is what you want. Do not use a package name for this checkout.

After changing the plugin entry, restart OpenCode and check startup logs for successful activation and configuration errors. An entry that is missing or fails to load provides no protection.

## Disable it if the judge is offline

With the defaults, a judge request failure blocks a call that needs review. If the session is stuck, stop OpenCode outside its TUI, edit the applicable project or global configuration, and remove only the `oc-one-guard` entry. Start OpenCode again. Setting `enabled` to `false` does not disable the blocked-host scan; removing the registration is the full disable path.

## Configuration files and packages

For a copied source folder, `config.json` or `config.jsonc` beside the plugin source supplies settings unless inline options override them. These local files are ignored by Git and excluded from the npm package. `config.example.json` is included as a sample, but it is not an exact copy of built-in defaults.

The package has no runtime npm dependencies and does not require `@opencode-ai/plugin`. An installed package should use inline options for non-default settings unless you maintain a local config beside its source; do not assume the package directory is writable.

See [configuration](configuration.md) for precedence and the full reference. For the host's plugin configuration format, see the [OpenCode plugin documentation](https://opencode.ai/docs/plugins/), noting it may describe versions newer than this plugin supports.

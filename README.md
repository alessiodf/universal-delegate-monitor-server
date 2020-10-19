# Universal Delegate Monitor Server

## Introduction

This repository contains the Universal Delegate Monitor Server plugin for blockchains powered by ARK Core 3.0. It broadcasts delegate statistics over the WebSocket protocol which can be viewed using the [Universal Delegate Monitor](https://github.com/alessiodf/universal-delegate-monitor).

## Installation

**This is TBC with the new `ark plugin:install` command.**

Once the plugin is installed, we must configure it by modifying `app.json`. This file is found in `~/.config/ark-core/{mainnet|devnet|testnet|unitnet}/app.json` depending on network.

Add a new entry to the `plugins` section within either the `relay` or `core` blocks **immedately before the `@arkecosystem/core-state` package**, depending on whether you wish to use the separate relay/forger processes or the unified Core respectively. Of course, you can also add the plugin to both blocks if you wish to have the freedom to swap between the separate processes and the unified Core. Your entry or entries should look like the following:

```
    "relay": {
        "plugins": [
            ...
            {
                "package": "@alessiodf/universal-delegate-monitor-server"
            },
            {
                "package": "@arkecosystem/core-state"
            },
            ...
        ]
    },
```

Or:

```
    "core": {
        "plugins": [
            ...
            {
                "package": "@alessiodf/universal-delegate-monitor-server"
            },
            {
                "package": "@arkecosystem/core-state"
            },
            ...
        ]
    },
```

## Running

After installation, make sure the `app.json` file is correctly configured and restart Core. If you are using the CLI, this will probably be `ark core:restart` (or `ark relay:restart` if you wish to use the separate processes rather than the unified Core), although `ark` may be different in the case of bridgechains. If using Core Control, run `ccontrol restart relay`. The log should include a line stating that the Universal Delegate Monitor Server has been started, along with the IP address and port that it is listening on.

The plugin will start whenever the Core or Relay process is running. To verify that it is working, open the [Universal Delegate Monitor](https://github.com/alessiodf/universal-delegate-monitor), click the `Select Wallet` dropdown box, choose `Custom or Unlisted Network...` and enter your server's IP address and the configured port followed by `Connect`.

If this is a new bridgechain or fork, you may choose to register it so everyone can access it via the Universal Delegate Monitor, or if it is an existing network but you would like to share your server with others so they can also connect to it to boost the decentralisation aspect of the Universal Delegate Monitor, you may choose to publish your node details. Instructions to do both of these things can be found in the [documentation](https://github.com/alessiodf/universal-delegate-monitor#readme) for the Universal Delegate Monitor.

## Configuration Options

By default, the plugin will listen on every IP address configured on the machine (this is represented in the log as the IP address `0.0.0.0`), and will use a port number that is exactly 1000 higher than the Core API port. So, if your Core API is using port 4003, the Universal Delegate Monitor Server will use port `5003`. If you wish to change the port, or restrict which IP addresses the server will listen on, you may configure the plugin as described below by adding or modifying the following options within `app.json`:

- `enabled` - Should be `true` to enable the plugin or `false` to disable it.

- `host` - A string of the IP address that should accept incoming connections. Omit this option to listen on all available IP addresses.

- `port` - A numeric value denoting the TCP port number that the server should listen on. If not specified, it will be 1000 higher than the Core API port.

## Credits

-   [All Contributors](../../contributors)
-   [alessiodf](https://github.com/alessiodf)

## License

[GPLv3](LICENSE) © [alessiodf](https://github.com/alessiodf)

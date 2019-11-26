# Universal Delegate Monitor Server

## Introduction

This repository contains the Universal Delegate Monitor Server plugin for blockchains powered by ARK Core. It broadcasts delegate statistics over the WebSocket protocol which can be viewed using the [Universal Delegate Monitor](https://github.com/alessiodf/universal-delegate-monitor) within the ARK Desktop Wallet.

## Installation

If Core has been installed using the standard installation script, you can install the plugin with the following command:

```yarn global add @alessiodf/universal-delegate-monitor-server```

If Core has been installed manually via git, enter the directory where Core has been installed and enter the following command:

```yarn add @alessiodf/universal-delegate-monitor-server```

Once the plugin has been installed, we must configure it by modifying `plugins.js`. The file is found in `~/.config/ark-core/{mainnet|devnet|testnet|unitnet}/plugins.js` depending on network, although `ark-core` may be different in the case of bridgechains or forks.

Add the following new section to the `module.exports` block for the configuration options. **Add it immedately before `"@arkecosystem/core-state": {},`** but be aware that `@arkecosystem` may be different in the case of bridgechains or forks that have rebranded Core:
```
    "@alessiodf/universal-delegate-monitor-server": {
        "enabled": true
    },
```

## Running

After installation, make sure the `plugins.js` file is correctly configured and restart Core. If you are using the CLI, this will probably be `ark relay:restart` (or `ark core:restart` if you are using the unified Core process), although `ark` may be different in the case of bridgechains or forks. If using Core Control, run `ccontrol restart relay`. The log should include a line stating that the Universal Delegate Monitor Server has been started, along with the IP address and port that it is listening on.

The plugin will start whenever the Core or Relay process is running. To verify that it is working, open the [Universal Delegate Monitor](https://github.com/alessiodf/universal-delegate-monitor) inside the ARK Desktop Wallet, click the `Select Wallet` dropdown box, choose `Custom or Unlisted Network...` and enter your server's IP address and the configured port followed by `Connect`.

If this is a new bridgechain or fork, you may choose to register it so everyone can access it via the Universal Delegate Monitor, or if it is an existing network but you would like to share your server with others so they can also connect to it to boost the decentralisation aspect of the Universal Delegate Monitor, you may choose to publish your node details. Instructions to do both of these things can be found in the [documentation](https://github.com/alessiodf/universal-delegate-monitor#readme) for the Universal Delegate Monitor.

## Configuration Options

By default, the plugin will listen on every IP address configured on the machine (this is represented in the log as the IP address `0.0.0.0`), and will use a port number that is exactly 1000 higher than the Core API port. So, if your Core API is using port 4003, the Universal Delegate Monitor Server will use port `5003`. If you wish to change the port, or restrict which IP addresses the server will listen on, you may configure the plugin as described below by adding or modifying the following options within `plugins.js`:

- `enabled` - Should be `true` to enable the plugin or `false` to disable it.

- `host` - A string of the IP address that should accept incoming connections. Omit this option to listen on all available IP addresses.

- `port` - A numeric value denoting the TCP port number that the server should listen on. If not specified, it will be 1000 higher than the Core API port.

## Credits

-   [All Contributors](../../contributors)
-   [alessiodf](https://github.com/alessiodf)

## License

[GPLv3](LICENSE) © [alessiodf](https://github.com/alessiodf)

exports.plugin = {
    defaults: {
        enabled: false,
        host: "0.0.0.0",
        port: parseInt(process.env.CORE_API_PORT, 10) + 1000 || 5003
    },
    pkg: require("../package.json"),
    async register(app, options) {
        if (!options.enabled) {
            return;
        }
        const scopes = Object.keys(app.plugins.plugins).filter(
            scope => scope.endsWith("/core-api") ||
                scope.endsWith("/core-blockchain") ||
                scope.endsWith("/core-event-emitter") ||
                scope.endsWith("/core-p2p") ||
                scope.endsWith("/core-state") ||
                scope.endsWith("/core-transaction-pool")
        ).map(
            scope => scope.substring(0, scope.lastIndexOf("/"))
        ).reduce((count, current) => {
            if (current in count) {
                count[current]++;
            } else {
                count[current] = 1;
            }
            return count;
        }, {});
        const scope = Object.keys(scopes).reduce((a, b) => scopes[a] > scopes[b] ? a : b);
        const DelegateMonitor = require("./delegate-monitor");
        new DelegateMonitor(app, options, scope).start();
    }
};

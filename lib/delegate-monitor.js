class DelegateMonitor {
    constructor (app, options, scope) {
        this.app = app;
        this.scope = scope;
        this.database = app.resolvePlugin("database");
        this.emitter = app.resolvePlugin("event-emitter");
        this.delay = require("delay");
        const { Crypto, Enums } = require(`${scope}/crypto`);
        const { formatTimestamp, roundCalculator } = require(`${scope}/core-utils`);
        const { Slots } = Crypto;
        this.TransactionType = Enums.TransactionType || Enums.TransactionTypes;
        this.formatTimestamp = formatTimestamp;
        this.Interfaces = require(`${scope}/core-interfaces`);
        this.roundCalculator = roundCalculator;
        this.Slots = Slots;
        this.allDelegates = null;
        this.busy = false;
        this.currentRound = {};
        this.lastBlock = null;
        this.lastBroadcast = null;
        this.lastCalculation = 0;
        this.nethash = JSON.stringify({ nethash: app.getConfig().get("network.nethash") });
        this.stateStarted = false;
        this.symbol = app.getConfig().get("network.client.symbol");
        this.timer = null;
        const WebSocket = require("ws");
        const logger = app.resolvePlugin("logger");
        try {
            this.wss = new WebSocket.Server({ host: options.host, port: options.port });
            this.OPEN = WebSocket.OPEN;
            this.wss.on("connection", ws => {
                ws.on("message", () => {
                    ws.terminate();
                });
                if(this.lastBroadcast && ws.readyState === this.OPEN) {
                    ws.send(this.nethash);
                    if (this.allDelegates) {
                        ws.send(this.allDelegates);
                    }
                    ws.send(this.lastBroadcast);
                }
            });
            logger.info(`Universal Delegate Monitor server started on ws://${options.host}:${options.port}`);
        } catch (error) {
            logger.warn(`Could not start Universal Delegate Monitor server: ${error.message}`);
        }
    };
    broadcast (data) {
        this.lastBroadcast = JSON.stringify(data);
        for (const client of this.wss.clients) {
            if (client.readyState === this.OPEN) {
                client.send(this.lastBroadcast);
            }
        }
    };
    async calculate (timer, force) {
        if (this.busy && !force) {
            return;
        }
        this.busy = true;
        clearTimeout(this.timer);
        const latest = await this.getLatestForger();
        const lastBlock = await this.getLastBlock();
        let round = this.roundCalculator.calculateRound(lastBlock.height + 1);
        const slot = this.Slots.getSlotNumber();
        if (lastBlock.height < round.roundHeight && slot === this.Slots.getSlotNumber(lastBlock.timestamp)) {
            round = this.roundCalculator.calculateRound(lastBlock.height);
        }
        const settings = this.app.getConfig().getMilestone(round.roundHeight);
        const numDelegates = settings.activeDelegates;
        const blocksForged = (await this.database.blocksBusinessRepository.search({ height: { from: round.roundHeight, to: round.roundHeight + numDelegates }, transform: false })).rows.length;
        if (this.currentRound.round !== round.round || !this.currentRound.keys) {
            await this.updateKeys(round, numDelegates);
        }
        let keys = Array.from(this.currentRound.keys);
        keys = keys.slice(keys.indexOf(keys[slot % numDelegates])).concat(keys).slice(0, numDelegates);
        if (slot !== this.currentRound.slot || lastBlock.id !== this.currentRound.block) {
            const delegates = await this.process(round, keys, settings.blocktime, numDelegates);
            if (delegates === null) {
                await this.delay(100);
                this.calculate(timer, true);
                return;
            }
            if (lastBlock.id === delegates[0].last_block) {
                delegates.push(delegates.shift());
            }
            this.currentRound = {
                initial: this.currentRound.initial,
                keys: this.currentRound.keys,
                slot
            };
            const syncing = await this.isSyncing();
            const transactions = latest.lastBlock && !isNaN(latest.lastBlock.numberOfTransactions) ? latest.lastBlock.numberOfTransactions : 0;
            if (!syncing || this.canBroadcast()) {
                const remaining = Math.max(numDelegates - blocksForged, 0);
                this.broadcast({
                    delegates: delegates.map(delegate => ({ rank: delegate.rank, name: delegate.name, last_forged: delegate.last_forged, status: delegate.status, time_due: delegate.time_due, time_secs: delegate.time_secs, weight: delegate.weight })),
                    height: lastBlock.height,
                    lastForger: latest.username,
                    ready: this.stateStarted,
                    remaining,
                    syncing: syncing && !!this.lastBlock,
                    symbol: this.symbol,
                    transactions
                });
            }
        }
        this.busy = false;
        this.lastCalculation = new Date().getTime();
        this.timer = setTimeout(() => {
            this.calculate(true);
        }, this.Slots.getTimeInMsUntilNextSlot());
    };
    canBroadcast () {
        return (new Date().getTime()) - this.lastCalculation >= 1000;
    };
    fetchAllDelegates () {
        return { "usernames": this.database.walletManager.allByUsername().filter(wallet => wallet.attributes ? !wallet.attributes.delegate.resigned : !wallet.resigned).map(wallet => wallet.attributes ? wallet.attributes.delegate.username : wallet.username) };
    };
    getDueTime (publicKey) {
        let dueTime;
        this.currentRound.initial.order.map(async (key, index) => {
            if (publicKey === key) {
                dueTime = this.Slots.getSlotTime(this.currentRound.initial.slot + index);
                return;
            }
        });
        return dueTime;
    };
    async getLastBlock () {
        let block = this.app.resolvePlugin("state").getStore().getLastBlock();
        if (!block) {
            block = await this.database.getLastBlock();
        }
        return block.data;
    };
    async getLatestForger () {
        const allDelegates = this.database.walletManager.allByUsername().filter(wallet => wallet.attributes ? wallet.attributes.delegate.lastBlock && wallet.attributes.delegate.lastBlock.height : wallet.lastBlock && wallet.lastBlock.height).map(wallet => wallet.attributes ? wallet.attributes.delegate : wallet);
        try {
            const latest = allDelegates.reduce((prev, current) => {
                return (prev.lastBlock.timestamp > current.lastBlock.timestamp) ? prev : current;
            });
            if (!this.allDelegates) {
                this.allDelegates = JSON.stringify(this.fetchAllDelegates());
                this.sendAllDelegates();
            }
            return latest;
        } catch (error) {
            await this.delay(100);
            return this.getLatestForger();
        }
    };
    async hasBlock (height) {
        const block = await this.database.blocksBusinessRepository.findByHeight(height);
        return !!block;
    };
    async isSyncing (block) {
        if (block) {
            this.lastBlock = { numDelegates: this.app.getConfig().getMilestone(block.height).activeDelegates, received: this.Slots.getSlotNumber(), slot: this.Slots.getSlotNumber(block.timestamp) };
        }
        if (!this.lastBlock) {
            return !this.stateStarted;
        }
        return this.lastBlock.slot + this.lastBlock.numDelegates < this.lastBlock.received;
    };
    async process (round, keys, time, numDelegates) {
        const rounds = [];
        rounds.push(this.roundCalculator.calculateRound(round.roundHeight > 1 ? round.roundHeight - 1 : 1));
        rounds.push(this.roundCalculator.calculateRound(rounds[0].roundHeight - 1));
        const roundPublicKeys = [];
        for (let i = 0; i < 2; i++) {
            roundPublicKeys.push((await this.database.getActiveDelegates(rounds[i])).map(delegate => delegate.publicKey));
        }
        const delegates = keys.map((key, index) => {
            const wallet = this.database.walletManager.findById(key);
            const delegateData = wallet.attributes ? wallet.attributes.delegate : wallet;
            const due = this.Slots.getSlotTime(this.Slots.getSlotNumber() + index);
            const slotPassed = this.getDueTime(key) + time <= this.Slots.getTime();
            const delegate = {
                key,
                last_block: delegateData.lastBlock ? delegateData.lastBlock.id : null,
                last_forged: delegateData.lastBlock ? this.formatTimestamp(delegateData.lastBlock.timestamp).unix : null,
                name: delegateData.username,
                rank: delegateData.rank ? delegateData.rank : delegateData.rate,
                time_due: this.formatTimestamp(due).unix,
                time_secs: this.formatTimestamp(due).unix - this.formatTimestamp(this.Slots.getSlotTime(this.Slots.getSlotNumber())).unix,
                weight: delegateData.voteBalance.toString()
            };
            if (delegateData.lastBlock && delegateData.lastBlock.height) {
                if (delegateData.lastBlock.height >= round.roundHeight) {
                    delegate.status = 1;
                } else if (roundPublicKeys[0].includes(key)) {
                    if (delegateData.lastBlock.height >= rounds[0].roundHeight) {
                        delegate.status = slotPassed ? 2 : 1;
                    } else if (delegateData.lastBlock.height >= rounds[1].roundHeight && !slotPassed) {
                        delegate.status = 2;
                    } else {
                        if(!roundPublicKeys[1].includes(key)) {
                            delegate.status = slotPassed ? 3 : 2;
                        } else {
                            delegate.status = 3;
                        }
                    }
                } else {
                    delegate.status = slotPassed ? 2 : 0;
                }
            } else {
                if (roundPublicKeys[0].includes(key) && roundPublicKeys[1].includes(key)) {
                    delegate.status = 3;
                } else if (roundPublicKeys[0].includes(key)) {
                    delegate.status = slotPassed ? 3 : 2;
                } else {
                    delegate.status = slotPassed ? 2 : 0;
                }
            }
            return delegate;
        });
        if (!delegates || delegates.length !== numDelegates ) {
            return null;
        }
        return delegates;
    };
    sendAllDelegates () {
        for (const client of this.wss.clients) {
            if (client.readyState === this.OPEN) {
                client.send(this.allDelegates);
            }
        }
    };
    async start () {
        const { ApplicationEvents } = require(`${this.scope}/core-event-emitter`);
        this.emitter.on(ApplicationEvents.StateBuilderFinished ? ApplicationEvents.StateBuilderFinished : "internal.stateBuilder.finished", async () => {
            await this.calculate(false);
            this.emitter.on(ApplicationEvents.BlockApplied, async block => {
                if (!(await this.isSyncing(block)) || this.canBroadcast()) {
                    clearTimeout(this.timer);
                    while (!(await this.hasBlock(block.height))) {
                        await this.delay(50);
                    }
                    this.stateStarted = true;
                    this.calculate(false);
                }
            });
            this.emitter.on(ApplicationEvents.BlockReverted, async () => {
                clearTimeout(this.timer);
                await this.delay(50);
                this.calculate(false);
            });
            this.emitter.on(ApplicationEvents.StateStarted, () => {
                this.stateStarted = true;
                this.calculate(false);
            });
            this.emitter.on(ApplicationEvents.TransactionApplied, transaction => {
                if ((transaction.type === this.TransactionType.DelegateRegistration || transaction.type === this.TransactionType.DelegateResignation) && this.allDelegates) {
                    this.allDelegates = JSON.stringify(this.fetchAllDelegates());
                    this.sendAllDelegates();
                }
            });
            this.emitter.on(ApplicationEvents.TransactionApplied, transaction => {
                if ((transaction.type === this.TransactionType.DelegateRegistration || transaction.type === this.TransactionType.DelegateResignation) && this.allDelegates) {
                    this.allDelegates = JSON.stringify(this.fetchAllDelegates());
                    this.sendAllDelegates();
                }
            });
        });
        if (!this.database) {
            this.broadcast({
                delegates: [],
                lastForger: "",
                ready: false,
                remaining: 0,
                syncing: false,
                transactions: 0
            });
        }
        while (!this.database) {
            await this.delay(1000);
            this.database = this.app.resolvePlugin("database");
        }
        this.broadcast({
            delegates: [],
            height: (await this.getLastBlock()).height,
            lastForger: "",
            ready: false,
            remaining: 0,
            syncing: false,
            transactions: 0
        });
    };
    async updateKeys (round, numDelegates) {
        try {
            const block = await this.database.blocksBusinessRepository.findByHeight(round.roundHeight > 1 ? round.roundHeight - 1 : 1);
            const delegates = await this.database.getActiveDelegates(round);
            const initialSlot = this.Slots.getSlotNumber(block.timestamp) + 1;
            this.currentRound.keys = delegates.map(delegate => delegate.publicKey);
            this.currentRound.initial = {
                order: this.currentRound.keys.slice(this.currentRound.keys.indexOf(this.currentRound.keys[initialSlot % numDelegates])).concat(this.currentRound.keys).slice(0, numDelegates),
                slot: initialSlot
            };
            return true;
        } catch (error) {
            await this.delay(100);
            return this.updateKeys(round, numDelegates);
        }
    }
};
module.exports = DelegateMonitor;
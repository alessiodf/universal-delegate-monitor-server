import { Repositories } from "@arkecosystem/core-database";
import { Container, Contracts, Enums, Services, Utils } from "@arkecosystem/core-kernel";
import { Crypto, Enums as CryptoEnums, Interfaces, Managers } from "@arkecosystem/crypto";
import delay from "delay";

import { Server } from "./server";

@Container.injectable()
export class Monitor {
    @Container.inject(Container.Identifiers.Application)
    private readonly app!: Contracts.Kernel.Application;

    @Container.inject(Container.Identifiers.DatabaseBlockRepository)
    private readonly blockRepository!: Repositories.BlockRepository;

    @Container.inject(Container.Identifiers.EventDispatcherService)
    private readonly events!: Contracts.Kernel.EventDispatcher;

    @Container.inject(Container.Identifiers.WalletRepository)
    @Container.tagged("state", "blockchain")
    private readonly walletRepository!: Contracts.State.WalletRepository;

    private allDelegates;
    private blockTimeLookup;
    private busy: boolean = false;
    private currentRound: any = {};
    private lastBlock;
    private lastBroadcast;
    private stateStarted: boolean = false;
    private timer;

    private lastCalculation: number = 0;

    private serverSymbol = Symbol.for("UniversalDelegateMonitorServer<Server>");

    public async boot(): Promise<void> {
        this.events.listen(Enums.StateEvent.BuilderFinished, {
            handle: () => {
                this.start();
            },
        });

        if (!this.getLastBlock()) {
            this.broadcast({
                delegates: [],
                lastForger: "",
                ready: false,
                remaining: 0,
                syncing: false,
                transactions: 0,
            });
        }

        let lastBlock!: Interfaces.IBlockData | undefined;

        while (!(lastBlock = this.getLastBlock())) {
            await delay(1000);
        }

        this.blockTimeLookup = await Utils.forgingInfoCalculator.getBlockTimeLookup(this.app, lastBlock.height);
        this.broadcast({
            delegates: [],
            height: lastBlock.height,
            lastForger: "",
            ready: false,
            remaining: 0,
            syncing: false,
            transactions: 0,
        });
    }

    public getAllDelegates(): any {
        return this.allDelegates;
    }

    public getLastBroadcast(): any {
        return this.lastBroadcast;
    }

    public getState(): any {
        return JSON.stringify({
            nethash: Managers.configManager.get("network.nethash"),
            symbol: Managers.configManager.get("network.client.symbol"),
        });
    }

    private broadcast(data): void {
        this.lastBroadcast = JSON.stringify(data);
        this.app.get<Server>(this.serverSymbol).broadcast(this.lastBroadcast);
    }

    private async calculate(timer: boolean, force: boolean = false): Promise<void> {
        if (this.busy && !force) {
            return;
        }
        this.busy = true;
        clearTimeout(this.timer);
        const latest = await this.getLatestForger();
        const lastBlock: Interfaces.IBlockData = (await this.getLastBlock()) as Interfaces.IBlockData;
        this.blockTimeLookup = await Utils.forgingInfoCalculator.getBlockTimeLookup(this.app, lastBlock.height);
        let round: Contracts.Shared.RoundInfo = Utils.roundCalculator.calculateRound(lastBlock.height + 1);
        const slot: number = Crypto.Slots.getSlotNumber(this.blockTimeLookup);
        if (
            lastBlock.height < round.roundHeight &&
            slot === Crypto.Slots.getSlotNumber(this.blockTimeLookup, lastBlock.timestamp)
        ) {
            round = Utils.roundCalculator.calculateRound(lastBlock.height);
        }
        const settings = Managers.configManager.getMilestone(round.roundHeight);
        const numDelegates: number = settings.activeDelegates;
        const blocksForged: number = (
            await this.blockRepository.findByHeightRange(round.roundHeight, round.roundHeight + numDelegates)
        ).length;
        if (this.currentRound.round !== round.round || !this.currentRound.keys) {
            await this.updateKeys(round, numDelegates);
        }
        let keys = Array.from(this.currentRound.keys);
        keys = keys
            .slice(keys.indexOf(keys[slot % numDelegates]))
            .concat(keys)
            .slice(0, numDelegates);
        if (slot !== this.currentRound.slot || lastBlock.id !== this.currentRound.block) {
            const delegates: Array<any> | undefined = await this.process(round, keys, settings.blocktime, numDelegates);
            if (delegates === undefined) {
                await delay(100);
                this.calculate(timer, true);
                return;
            }
            if (lastBlock.id === delegates[0].last_block) {
                delegates.push(delegates.shift());
            }
            this.currentRound = {
                initial: this.currentRound.initial,
                keys: this.currentRound.keys,
                slot,
            };
            const syncing: boolean = await this.isSyncing();
            const transactions: number =
                latest.lastBlock && !isNaN(latest.lastBlock.numberOfTransactions)
                    ? latest.lastBlock.numberOfTransactions
                    : 0;
            if (!syncing || this.canBroadcast()) {
                const remaining: number = Math.max(numDelegates - blocksForged, 0);
                this.broadcast({
                    delegates: delegates.map((delegate) => ({
                        rank: delegate.rank,
                        name: delegate.name,
                        last_forged: delegate.last_forged,
                        status: delegate.status,
                        time_due: delegate.time_due,
                        time_secs: delegate.time_secs,
                        weight: delegate.weight,
                    })),
                    height: lastBlock.height,
                    lastForger: latest.username,
                    ready: this.stateStarted,
                    remaining,
                    syncing: syncing && !!this.lastBlock,
                    transactions,
                });
            }
        }
        this.busy = false;
        this.lastCalculation = new Date().getTime();
        this.timer = setTimeout(() => {
            this.calculate(true);
        }, Crypto.Slots.getTimeInMsUntilNextSlot(this.blockTimeLookup));
    }

    private canBroadcast(): boolean {
        return new Date().getTime() - this.lastCalculation >= 1000;
    }

    private fetchAllDelegates(): any {
        return {
            usernames: this.walletRepository
                .allByUsername()
                .filter((wallet) => !wallet.hasAttribute("delegate.resigned"))
                .map((wallet) => wallet.getAttribute("delegate.username")),
        };
    }

    private getDueTime(publicKey): number {
        let dueTime!: number;
        this.currentRound.initial.order.map(async (key, index) => {
            if (publicKey === key) {
                dueTime = Crypto.Slots.getSlotTime(this.blockTimeLookup, this.currentRound.initial.slot + index);
                return;
            }
        });
        return dueTime;
    }

    private getLastBlock(): Interfaces.IBlockData | undefined {
        let block: Interfaces.IBlock | undefined;
        try {
            block = this.app.get<Contracts.State.StateStore>(Container.Identifiers.StateStore).getLastBlock();
        } catch {
            return undefined;
        }
        return block.data;
    }

    private async getLatestForger(): Promise<any> {
        const allDelegates = this.walletRepository
            .allByUsername()
            .filter(
                (wallet) =>
                    wallet.hasAttribute("delegate.lastBlock") &&
                    wallet.getAttribute("delegate").lastBlock &&
                    wallet.getAttribute("delegate").lastBlock.height,
            )
            .map((wallet) => wallet.getAttribute("delegate"));
        try {
            const latest = allDelegates.reduce((prev, current) => {
                return prev.lastBlock.timestamp > current.lastBlock.timestamp ? prev : current;
            });
            if (!this.allDelegates) {
                this.allDelegates = JSON.stringify(this.fetchAllDelegates());
                this.sendAllDelegates();
            }
            return latest;
        } catch (error) {
            await delay(100);
            return this.getLatestForger();
        }
    }

    private async hasBlock(height): Promise<boolean> {
        const block = await this.blockRepository.findByHeight(height);
        return !!block;
    }

    private async isSyncing(block?): Promise<boolean> {
        if (block) {
            this.lastBlock = {
                numDelegates: Managers.configManager.getMilestone(block.height).activeDelegates,
                received: Crypto.Slots.getSlotNumber(this.blockTimeLookup),
                slot: Crypto.Slots.getSlotNumber(this.blockTimeLookup, block.timestamp),
            };
        }
        if (!this.lastBlock) {
            return !this.stateStarted;
        }
        return this.lastBlock.slot + this.lastBlock.numDelegates < this.lastBlock.received;
    }

    private async process(round, keys, time, numDelegates): Promise<Array<any> | undefined> {
        const rounds: Array<Contracts.Shared.RoundInfo> = [];
        rounds.push(Utils.roundCalculator.calculateRound(round.roundHeight > 1 ? round.roundHeight - 1 : 1));
        rounds.push(Utils.roundCalculator.calculateRound(rounds[0].roundHeight - 1));
        const roundPublicKeys: Array<any> = [];
        for (let i = 0; i < 2; i++) {
            const delegates: Contracts.State.Wallet[] = (await this.app
                .get<Services.Triggers.Triggers>(Container.Identifiers.TriggerService)
                .call("getActiveDelegates", { roundInfo: rounds[i] })) as Contracts.State.Wallet[];
            roundPublicKeys.push(delegates.map((delegate) => delegate.publicKey));
        }
        const delegates: Array<any> = keys.map((key, index) => {
            const wallet: Contracts.State.Wallet = this.walletRepository.findByPublicKey(key);
            const delegateData = wallet.getAttribute("delegate");
            const due: number = Crypto.Slots.getSlotTime(
                this.blockTimeLookup,
                Crypto.Slots.getSlotNumber(this.blockTimeLookup) + index,
            );
            const slotPassed: boolean = this.getDueTime(key) + time <= Crypto.Slots.getTime();
            const delegate: any = {
                key,
                last_block: delegateData.lastBlock ? delegateData.lastBlock.id : null,
                last_forged: delegateData.lastBlock
                    ? Utils.formatTimestamp(delegateData.lastBlock.timestamp).unix
                    : null,
                name: delegateData.username,
                rank: delegateData.rank ? delegateData.rank : delegateData.rate,
                time_due: Utils.formatTimestamp(due).unix,
                time_secs:
                    Utils.formatTimestamp(due).unix -
                    Utils.formatTimestamp(
                        Crypto.Slots.getSlotTime(
                            this.blockTimeLookup,
                            Crypto.Slots.getSlotNumber(this.blockTimeLookup),
                        ),
                    ).unix,
                weight: delegateData.voteBalance.toString(),
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
                        if (!roundPublicKeys[1].includes(key)) {
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
        if (!delegates || delegates.length !== numDelegates) {
            return undefined;
        }
        return delegates;
    }

    private sendAllDelegates(): void {
        this.app.get<Server>(this.serverSymbol).broadcast(this.allDelegates);
    }

    private async start(): Promise<void> {
        await this.calculate(false);
        this.events.listen(Enums.BlockEvent.Applied, {
            handle: async ({ data }) => {
                if (!(await this.isSyncing(data)) || this.canBroadcast()) {
                    clearTimeout(this.timer);
                    while (!(await this.hasBlock(data.height))) {
                        await delay(50);
                    }
                    this.stateStarted = true;
                    this.calculate(false);
                }
            },
        });

        this.events.listen(Enums.BlockEvent.Reverted, {
            handle: async () => {
                clearTimeout(this.timer);
                await delay(50);
                this.calculate(false);
            },
        });

        this.events.listen(Enums.StateEvent.Started, {
            handle: () => {
                this.stateStarted = true;
                this.calculate(false);
            },
        });

        this.events.listen(Enums.TransactionEvent.Applied, {
            handle: ({ data }) => {
                if (
                    (data.type === CryptoEnums.TransactionType.DelegateRegistration ||
                        data.type === CryptoEnums.TransactionType.DelegateResignation) &&
                    this.allDelegates
                ) {
                    this.allDelegates = JSON.stringify(this.fetchAllDelegates());
                    this.sendAllDelegates();
                }
            },
        });
    }

    private async updateKeys(round, numDelegates): Promise<boolean> {
        try {
            const blockData: Interfaces.IBlockData | undefined = await this.blockRepository.findByHeight(
                round.roundHeight > 1 ? round.roundHeight - 1 : 1,
            );
            const delegates: Contracts.State.Wallet[] = (await this.app
                .get<Services.Triggers.Triggers>(Container.Identifiers.TriggerService)
                .call("getActiveDelegates", { roundInfo: round })) as Contracts.State.Wallet[];
            const initialSlot: number = Crypto.Slots.getSlotNumber(this.blockTimeLookup, blockData!.timestamp) + 1;
            this.currentRound.keys = delegates.map((delegate) => delegate.publicKey);
            this.currentRound.initial = {
                order: this.currentRound.keys
                    .slice(this.currentRound.keys.indexOf(this.currentRound.keys[initialSlot % numDelegates]))
                    .concat(this.currentRound.keys)
                    .slice(0, numDelegates),
                slot: initialSlot,
            };
            return true;
        } catch (error) {
            await delay(100);
            return this.updateKeys(round, numDelegates);
        }
    }
}

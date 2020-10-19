import { Container, Contracts, Types } from "@arkecosystem/core-kernel";
import WebSocket from "ws";

import { Monitor } from "./monitor";

@Container.injectable()
export class Server {
    @Container.inject(Container.Identifiers.Application)
    private readonly app!: Contracts.Kernel.Application;

    @Container.inject(Container.Identifiers.LogService)
    private readonly logger!: Contracts.Kernel.Logger;

    private server!: WebSocket.Server;
    private name!: string;
    private optionsServer!: Types.JsonObject;
    private monitorSymbol = Symbol.for("UniversalDelegateMonitorServer<Monitor>");

    public async initialize(name: string, optionsServer: Types.JsonObject): Promise<void> {
        this.name = name;
        this.optionsServer = optionsServer;
    }

    public async boot(): Promise<void> {
        const host = this.optionsServer.host;
        const port = Number(this.optionsServer.port);
        try {
            this.server = new WebSocket.Server({ host, port });
            this.server.on("connection", (ws) => {
                ws.on("message", () => {
                    ws.terminate();
                });

                const lastBroadcast = this.app.get<Monitor>(this.monitorSymbol).getLastBroadcast();

                if (lastBroadcast && ws.readyState === WebSocket.OPEN) {
                    const allDelegates = this.app.get<Monitor>(this.monitorSymbol).getAllDelegates();
                    const state = this.app.get<Monitor>(this.monitorSymbol).getState();
                    ws.send(state);
                    if (allDelegates) {
                        ws.send(allDelegates);
                    }
                    ws.send(lastBroadcast);
                }
            });
            this.logger.info(`${this.name} started at http://${this.server.options.host}:${this.server.options.port}`);
        } catch {
            await this.app.terminate(`Failed to start ${this.name}!`);
        }
    }

    public broadcast(data: string): void {
        for (const client of this.server.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        }
    }

    public async dispose(): Promise<void> {
        try {
            await this.server.stop();
            this.logger.info(`${this.name} stopped at http://${this.server.options.host}:${this.server.options.port}`);
        } catch {
            await this.app.terminate(`Failed to stop ${this.name}!`);
        }
    }
}

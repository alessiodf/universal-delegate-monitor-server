export const defaults = {
    enabled: true,
    server: {
        host: "0.0.0.0",
        port: (Number(process.env.CORE_API_PORT) || 4003) + 1000,
    },
};

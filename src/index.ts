import { app } from "./app/app.js";

const PORT = Number(process.env.PORT) || 3000;

try {
    await app.listen({
        host: "0.0.0.0",
        port: PORT,
    });

    app.log.info(`Server running on port ${PORT}`);
} catch (error) {
    app.log.error(error);

    process.exit(1);
}
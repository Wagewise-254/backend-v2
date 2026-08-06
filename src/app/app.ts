import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";

export const app = Fastify({
    logger: true,
});

await app.register(cors);

await app.register(swagger, {
    openapi: {
        info: {
            title: "WageWise API",
            version: "5.0.0",
        },
    },
});

await app.register(swaggerUI, {
    routePrefix: "/docs",
});

app.get("/", async () => {
    return {
        success: true,
        name: "WageWise Payroll API",
        version: "5.0.0",
    };
});

app.get("/health", async () => {
    return {
        success: true,
        status: "healthy",
        timestamp: new Date().toISOString(),
    };
});
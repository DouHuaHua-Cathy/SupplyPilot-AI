import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const allowedOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false }));
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

if (process.env.SUPPLYPILOT_SERVE_WEB === "true") {
  const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../supplypilot-ai/dist/public");
  app.use(express.static(frontendDir, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res, next) => {
    res.sendFile(resolve(frontendDir, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}

export default app;

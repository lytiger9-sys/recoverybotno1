import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const pagePath = fileURLToPath(new URL("./index.html", import.meta.url));

function getHealthSnapshot(getRuntime) {
  const runtime = getRuntime();
  const database = mongoose.connection.readyState === 1;
  const discord = Boolean(runtime?.client?.isReady());
  return {
    status: database && discord ? "online" : "degraded",
    database: database ? "online" : "offline",
    discord: discord ? "online" : "offline",
    bot: runtime?.client?.user?.username ?? null,
    checkedAt: new Date().toISOString(),
  };
}

export async function startHealthServer(getRuntime, port = Number(process.env.PORT || 3001)) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be a valid TCP port.");
  const page = await readFile(pagePath);
  const server = createServer((request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" }).end();
      return;
    }
    if (request.url === "/health") {
      const snapshot = getHealthSnapshot(getRuntime);
      response.writeHead(snapshot.status === "online" ? 200 : 503, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      }).end(JSON.stringify(snapshot));
      return;
    }
    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      }).end(page);
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  console.log("Health website listening on port:", typeof address === "object" && address ? address.port : port);
  return () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

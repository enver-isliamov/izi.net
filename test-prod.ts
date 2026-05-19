import { execSync } from "child_process";
import fs from "fs";

execSync("npx -y tsx server.ts", {
    env: { ...process.env, NODE_ENV: "production", PORT: "3006" },
    stdio: "inherit"
});

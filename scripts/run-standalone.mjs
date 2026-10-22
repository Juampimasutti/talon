#!/usr/bin/env node
import { loadEnv } from "./load-env-runtime.mjs";

loadEnv();
process.env.HOSTNAME ||= "0.0.0.0";
process.env.PORT ||= "4318";
await import("../server.js");

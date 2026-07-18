// Side-effect import: parse ./.env into process.env BEFORE any other module
// reads env at load time. Must stay the FIRST import of every entrypoint.
import { loadEnv } from "./env.js";

loadEnv();

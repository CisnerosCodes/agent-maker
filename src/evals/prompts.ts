// Print every level's id + prompt as JSON. Used to collect responses
// out-of-band (e.g. via Claude Code subagents) for the "file" backend.
//   npm run eval:prompts > prompts.json
import { LEVELS } from "./levels.js";

console.log(JSON.stringify(LEVELS.map((l) => ({ id: l.id, tier: l.tier, prompt: l.prompt })), null, 2));

/**
 * Hill climbing on the full-action-space greedy bot (logic/engine/botFull.ts, model kind
 * "greedy-full"): scripts/train-hill.ts with --space full. That tunes every knob of FullWeights
 * (the greedy feature weights, one multiplier and one "open" knob per action type, one weight per
 * tech, unit type, build/ability and city reward, and the centre pull), 4 per round by default,
 * with everything the hill climber has: the margin test, the opponent league, adaptive sigma,
 * averaged champions, early stop on point share, milestones, checkpoints and the progress line.
 * Games run in the Rust engine.
 *
 *   npm run train-full -- --id greedy-full-v1 --budget 1260160 --from greedy-hill-v4
 *
 * --from takes a greedy-full model, or a greedy one (its weights become the greedy part on top of
 * the full defaults). The result is models/<id>/model.json (kind "greedy-full", weights under
 * "full"), which the app, the arena and the arena server can play.
 */
if (!process.argv.includes("--space")) process.argv.splice(2, 0, "--space", "full");
require("./train-hill");

/**
 * Demo: compute a statutory response deadline (spec §7). No API key needed.
 *
 *   npm run duedate -- CA
 *   npm run duedate -- TX 2026-07-27
 *   npm run duedate -- IL 2026-07-27 5   # with a 5-day extension
 */
import { computeDueDate } from "../src/statute/computeDueDate";
import { getStateProfile, supportedStates } from "../src/statute/profiles";

const [stateArg, receivedArg, extensionArg] = process.argv.slice(2);
const state = (stateArg ?? "CA").toUpperCase();

const profile = getStateProfile(state);
if (!profile) {
  console.error(`Unknown state "${state}". Supported: ${supportedStates.join(", ")}`);
  process.exit(1);
}

const receivedAt = receivedArg ? new Date(`${receivedArg}T12:00:00Z`) : new Date();
if (Number.isNaN(receivedAt.getTime())) {
  console.error(`Invalid received date "${receivedArg}". Use YYYY-MM-DD.`);
  process.exit(1);
}

const extension = extensionArg
  ? { days: Number(extensionArg), reason: profile.responseClock.extension.permittedReasons[0] }
  : undefined;

const result = computeDueDate({
  receivedAt,
  clock: profile.responseClock,
  holidays: [], // a real agency passes its observed-holiday calendar here
  extension,
});

console.log(`\n${profile.stateName} public-records request`);
console.log(`  received:         ${receivedAt.toISOString().slice(0, 10)}`);
console.log(`  statutory due:    ${result.statutoryDueAt.toISOString().slice(0, 10)}`);
if (result.extensionApplied) {
  console.log(`  extended due:     ${result.dueAt.toISOString().slice(0, 10)}`);
}
console.log(`  basis:            ${result.basis}\n`);

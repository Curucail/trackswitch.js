import { spawnSync } from "node:child_process";

let payload = {};

try {
	const chunks = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}

	const input = Buffer.concat(chunks).toString("utf8").trim();
	if (input) {
		payload = JSON.parse(input);
	}
} catch {
	payload = {};
}

const result = spawnSync("npm", ["exec", "--", "biome", "check", "--write", "src"], {
	encoding: "utf8",
	stdio: ["ignore", "pipe", "pipe"],
});

if (result.stdout) {
	process.stderr.write(result.stdout);
}

if (result.stderr) {
	process.stderr.write(result.stderr);
}

if (result.status === 0) {
	process.stdout.write(JSON.stringify({ continue: true }));
	process.exit(0);
}

const stopHookActive =
	typeof payload === "object" &&
	payload !== null &&
	payload.stop_hook_active === true;

const reason =
	"Biome formatting/linting failed. Run `npm exec -- biome check --write src`, fix the reported source issues, and verify before stopping.";

if (stopHookActive) {
	process.stdout.write(
		JSON.stringify({
			continue: false,
			stopReason: reason,
			systemMessage: reason,
		}),
	);
	process.exit(0);
}

process.stdout.write(
	JSON.stringify({
		decision: "block",
		reason,
	}),
);

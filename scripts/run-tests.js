import fs from "fs";
import path from "path";
import { execa } from "execa";
import { Listr } from "listr2";
import table from "text-table";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import "colors";

/* eslint-disable no-control-regex */
/* prettier-ignore no-control-regex */

const root = process.cwd();
const skills = fs.existsSync(path.join(root, "skills"))
	? (fs
			.readdirSync(path.join(root, "skills"), { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name) ?? [])
	: [];
const argv = yargs()
	.usage("$0 [skills...]", "run test suite for the given skills", (yargs) => {
		return yargs
			.positional("skills", {
				type: "array",
				of: "string",
				optional: true,
				choices: skills,
				default: skills,
				description: "the names of the skills to run the tests for",
			})
			.options({
				coverageOnly: {
					type: "boolean",
					description: "only run coverage reports",
					default: false,
				},
			});
	})
	.help()
	.parseSync(hideBin(process.argv));

/**
 * Resolve the Python executable to use. Prefers a repo-root `.venv` if one
 * exists so developers on Homebrew/system Python (which blocks global pip
 * installs) don't need to manually activate a virtual environment first.
 *
 * Resolution order:
 *   1. .venv/bin/python3  (macOS / Linux venv)
 *   2. .venv/Scripts/python.exe  (Windows venv)
 *   3. python3  (whatever is on PATH — CI, nix, activated shell)
 */
function resolvePython() {
	const venvPosix = path.join(root, ".venv", "bin", "python3");
	const venvWin = path.join(root, ".venv", "Scripts", "python.exe");
	if (fs.existsSync(venvPosix)) return venvPosix;
	if (fs.existsSync(venvWin)) return venvWin;
	return "python3";
}

/**
 * @typedef {Object} TestFailure - Data extracted from the structured longrepr.
 * @property {string} nodeid - The node ID of the test.
 * @property {string} message - The message of the failure.
 */

/**
 * @typedef {Object} CoverageByFile - Data extracted from the coverage report file.
 * @property {import("fs").PathLike} filename - The name of the file.
 * @property {number} rate - The rate of the coverage.
 * @property {string[]} uncoveredLines - The uncovered lines of the coverage.
 */

/**
 * @typedef {Object} CoverageTotals - Data extracted from the coverage report file.
 * @property {number} covered_lines - The number of covered lines.
 * @property {number} num_statements - The number of statements.
 * @property {number} percent_covered - The percentage of the lines covered.
 * @property {string} percent_covered_display - The human-readable percentage of the lines covered.
 * @property {number} missing_lines - The number of missing lines.
 * @property {number} excluded_lines - The number of excluded lines.
 * @property {number} percent_statements_covered - The percentage of the statements covered.
 * @property {string} percent_statements_covered_display - The human-readable percentage of the statements covered.
 */

/**
 * @typedef {Object} CoverageReport - Data extracted from the coverage report.
 * @property {CoverageTotals} totals - The totals of the coverage report.
 * @property {CoverageByFile[]} files - The files of the coverage report.
 */

/**
 * @typedef {Object} ReportLog - Data extracted from the pytest-reportlog JSONL file.
 * @property {number} total - The total number of tests.
 * @property {number} passed - The number of tests that passed.
 * @property {number} failed - The number of tests that failed.
 * @property {number} time - The time taken to run the tests.
 * @property {TestFailure[]} failures - The failures of the tests.
 */

/**
 * Parse a pytest-reportlog JSONL file written by --report-log.
 *
 * Only `TestReport` events with `when === "call"` are counted — these are
 * the actual test invocations, not setup/teardown phases.
 *
 * @param {import("fs").PathLike} reportLogPath - The path to the pytest-reportlog JSONL file.
 * @returns {ReportLog|void} The parsed report log or void if the file does not exist.
 */
function parseReportLog(reportLogPath) {
	if (!fs.existsSync(reportLogPath)) return;

	// Read the report log file and parse the events.
	const events = fs
		.readFileSync(reportLogPath, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return null;
			}
		})
		.filter(Boolean);

	// Filter the events to only include the call results.
	const callResults = events.filter(
		(e) => e.$report_type === "TestReport" && e.when === "call"
	);

	// Separate the passed and failed tests.
	const passed = callResults.filter((e) => e.outcome === "passed");
	const failed = callResults.filter((e) => e.outcome !== "passed");

	// Calculate the time taken to run the tests.
	const time = callResults.reduce((sum, e) => sum + (e.duration || 0), 0);

	// Extract the failures from the call results.
	const failures = failed.map((e) => {
		const repr = e.longrepr;
		let message = "unknown failure";
		if (typeof repr === "string") {
			message = repr.split("\n").find((l) => l.trim()) || repr;
		} else if (repr && repr.reprcrash) {
			message = `${repr.reprcrash.path}:${repr.reprcrash.lineno} — ${repr.reprcrash.message}`;
		}
		return { nodeid: e.nodeid, message };
	});

	// Return the report log.
	return {
		total: callResults.length,
		passed: passed.length,
		failed: failed.length,
		time,
		failures,
	};
}

/**
 * Parse `node --test` spec reporter summary lines from combined stdout/stderr.
 *
 * @param {string} text
 * @returns {ReportLog}
 */
function parseNodeTestOutput(text) {
	const s = stripAnsi(text || "");
	const testsM = s.match(/ℹ tests (\d+)/);
	const passM = s.match(/ℹ pass (\d+)/);
	const failM = s.match(/ℹ fail (\d+)/);
	const durM = s.match(/ℹ duration_ms ([\d.]+)/);
	const total = testsM ? parseInt(testsM[1], 10) : 0;
	const passed = passM ? parseInt(passM[1], 10) : 0;
	const failed = failM ? parseInt(failM[1], 10) : 0;
	const time = durM ? parseFloat(durM[1]) / 1000 : 0;
	const failures = [];
	if (failed > 0) {
		const failBlock = s.split(/failing tests?:/i)[1];
		if (failBlock) {
			const chunks = failBlock.split(/\n(?=test at |\n✖)/);
			for (const chunk of chunks) {
				const nameM = chunk.match(/✖\s+([^\n]+)/);
				const msgM = chunk.match(
					/AssertionError[^\n]*\n\s*([\s\S]*?)(?=\n\s*at |\n\n|$)/
				);
				if (nameM) {
					failures.push({
						nodeid: nameM[1].trim(),
						message:
							(msgM && msgM[1] ? msgM[1] : chunk)
								.split("\n")
								.map((l) => l.trim())
								.filter(Boolean)[0] || "failed",
					});
				}
			}
		}
	}
	return { total, passed, failed, time, failures };
}

/**
 * Skills without requirements.txt use the workspace `test` script as-is (e.g. Node + c8).
 *
 * @param {string} skillName
 * @returns {boolean}
 */
function isPytestSkill(skillName) {
	return fs.existsSync(
		path.join(root, "skills", skillName, "requirements.txt")
	);
}

/**
 * Parse a coverage XML file written by --cov-report=xml.
 *
 * Returns the coverage percentage as a number or void if the file does not exist.
 *
 * @param {import("fs").PathLike} reportPath - The path to the coverage JSON file.
 * @returns {CoverageReport|void} The coverage report or void if the file does not exist.
 */
function parseCoverage(reportPath) {
	if (!fs.existsSync(reportPath)) return;

	const reportContent = fs.readFileSync(reportPath, "utf8");
	const report = reportContent ? JSON.parse(reportContent) : null;
	const coverage = { totals: report?.totals };
	coverage.files = Object.entries(report?.files ?? {}).reduce(
		(acc, [testFile, results]) => {
			const groupedLines = [];
			let idx = 0;
			while (idx < results?.missing_lines?.length) {
				const start = results.missing_lines[idx];
				let end = start;
				while (
					results?.missing_lines?.[idx + 1] &&
					results?.missing_lines?.[idx + 1] === end + 1
				) {
					end++;
					idx++;
				}

				groupedLines.push(
					start !== end ? `${start}-${end}` : String(start)
				);
				idx++;
			}
			acc.push({
				name: path.basename(testFile),
				rate: results.summary.percent_covered,
				uncoveredLines: groupedLines,
			});
			return acc;
		},
		[]
	);
	return coverage;
}

/**
 * Print the coverage percentage in a human-readable format.
 *
 * @param {number|void} c - The coverage percentage.
 * @returns {string} The coverage percentage in a human-readable format.
 */
const printCoverage = (c) =>
	typeof c === "number"
		? `${c > 80 ? String(Math.round(c)).green : String(Math.round(c)).yellow}%`
		: `—`.dim;

/**
 * Print the number of failed tests in a human-readable format.
 *
 * @param {number} f - The number of failed tests.
 * @returns {string} The number of failed tests in a human-readable format.
 */
const printFailCount = (f, t) => (f > 0 && t > 0 ? String(f).red : String(f));

/**
 * Print the number of passed tests in a human-readable format.
 *
 * @param {number} p - The number of passed tests.
 * @param {number} t - The total number of tests.
 * @returns {string} The number of passed tests in a human-readable format.
 */
const printPassed = (p, t) => (p > 0 && t > 0 ? String(p).green : String(p));

/**
 * Print the time taken to run the tests in a human-readable format.
 *
 * @param {number} t - The time taken to run the tests.
 * @returns {string} The time taken to run the tests in a human-readable format.
 */
const printTime = (t) =>
	typeof t === "number"
		? t > 0 && t.toFixed(2) === "0.00"
			? `>0.01s`
			: `${t.toFixed(2)}s`
		: "";

/**
 * Strip ANSI escape codes from a string.
 *
 * @param {string} s - The string to strip ANSI escape codes from.
 * @returns {string} The string with ANSI escape codes removed.
 */

const stripAnsi = (s) =>
	typeof s === "string" ? s.replace(/\x1B\[\d+m/g, "") : s;

/**
 * Add borders to a table.
 *
 * @param {string} table - The table to add borders to. This should be a string with each line separated by a newline character.
 * @returns {string[]} The table with borders.
 */
const addTableBorders = (table) => {
	const lines = table
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	const lineWidth = lines
		.map((l) => stripAnsi(l).length)
		.reduce((a, b) => Math.max(a, b), 0);
	const rule = "─".dim.repeat(lineWidth);
	return [rule + "\n", ...lines.map((l) => l + "\n" + rule)];
};

/**
 * Run the tests for a given skill.
 *
 * @param {string} skillName - The name of the skill.
 * @param {Object} ctx - The context object.
 * @returns {Promise<Object>} The result of the tests.
 */
async function runSkillTests(skillName, ctx) {
	// Create the reports directory if it doesn't exist.
	if (!fs.existsSync(path.join(root, "reports"))) {
		fs.mkdirSync(path.join(root, "reports"), { recursive: true });
	}

	// Clear the report log file if it exists.
	if (fs.existsSync(ctx.resultLog(skillName)))
		fs.unlinkSync(ctx.resultLog(skillName));

	let output = "\n\n";

	const pytestArgs = [
		"workspace",
		`@allons-y/skill-${skillName}`,
		"test",
		`--report-log=${ctx.resultLog(skillName)}`,
		`--cov=${ctx.scriptsDirectory(skillName)}`,
		`--cov-report=json:${ctx.coverageReport(skillName)}`,
	];

	const nodeArgs = ["workspace", `@allons-y/skill-${skillName}`, "test"];

	const result = await execa(
		"yarn",
		isPytestSkill(skillName) ? pytestArgs : nodeArgs,
		{
			reject: false,
			all: true,
			cwd: root,
			env: isPytestSkill(skillName)
				? { ...process.env, PYTHONPATH: ctx.skillDirectory(skillName) }
				: process.env,
		}
	).catch((err) => {
		if (err?.message) {
			output += `${err?.message ?? err}\n\n`;
		}
	});

	if (result?.all || result?.stdout) {
		output += `${result.all || result.stdout}\n\n`;
	}

	const report = isPytestSkill(skillName)
		? parseReportLog(ctx.resultLog(skillName))
		: parseNodeTestOutput(result?.all || result?.stdout || "");
	const coverage = isPytestSkill(skillName)
		? parseCoverage(ctx.coverageReport(skillName))
		: undefined;

	// Return the context object for the skill.
	return {
		failed: result.exitCode !== 0,
		output,
		report,
		coverage,
	};
}

/**
 * Print the summary table of the test results.
 *
 * @param {Object} results - The results object.
 * @returns {string} The summary table of the test results.
 */
function printSummaryTable(results) {
	const rows = Object.entries(results).filter(([, data]) => data.report);
	if (rows.length === 0) return;

	const headers = ["Skill", "Tests", "Passed", "Failed", "Time", "Coverage"];
	let totalTests = 0;
	let totalPassed = 0;
	let totalFailed = 0;
	let totalCoverage = 0;
	let totalTime = 0;

	let coverageSkillCount = 0;
	const dataRows = rows.map(([skillName, data]) => {
		const { total, passed, failed, time } = data.report || {};
		totalTests += total;
		totalPassed += passed;
		totalFailed += failed;
		const pct = data.coverage?.totals?.percent_covered;
		if (typeof pct === "number") {
			totalCoverage += pct;
			coverageSkillCount += 1;
		}
		totalTime += time;
		return [
			skillName.magenta,
			String(total),
			printPassed(passed, total),
			printFailCount(failed, total),
			printTime(time),
			printCoverage(typeof pct === "number" ? pct : undefined),
		];
	});

	const footerRow = [
		"Total".bold,
		String(totalTests),
		printPassed(totalPassed, totalTests),
		printFailCount(totalFailed, totalTests),
		printTime(totalTime),
		printCoverage(
			coverageSkillCount > 0
				? totalCoverage / coverageSkillCount
				: undefined
		),
	];

	const output = table([headers.map((h) => h.bold), ...dataRows, footerRow], {
		align: ["l", "c", "c", "c", "r", "r"],
		stringLength: (s) => stripAnsi(s).length,
	});

	const resultLines = [];
	resultLines.push(...addTableBorders(output));

	const allFailures = rows.flatMap(([, data]) =>
		(data.report?.failures || []).map((f) => ({ ...f }))
	);
	if (allFailures.length > 0) {
		resultLines.push("\n\nFailed tests:");
		for (const f of allFailures) {
			resultLines.push(`  ${"✗".red}  ${f.nodeid}`);
			resultLines.push(`     ${f.message}`);
		}
	}

	resultLines.push();
	return resultLines.join("\n");
}

/**
 * Main function to run the tests.
 *
 * @returns {Promise<void>} The result of the tests.
 * @throws {Error} If the tests fail.
 */
async function main() {
	const tasks = new Listr(
		[
			{
				title: "Run tests",
				task: async (ctx, task) => {
					ctx.results = {};
					return task.newListr(
						ctx.skills.map((name) => ({
							title: `${name.magenta}`,
							task: async (ctx) => {
								return runSkillTests(name, ctx).then(
									(result) => {
										ctx.results[name] = result;
										return result;
									}
								);
							},
						})),
						{ concurrent: true }
					);
				},
			},
			{
				title: "Print summary table",
				enabled: (ctx) => !ctx.coverageOnly,
				task: async (ctx, task) => {
					if (Object.keys(ctx.results).length === 0) {
						throw new Error(`No test results collected.\n`);
					}

					// Show full test output
					for (const [skillName, data] of Object.entries(
						ctx.results
					)) {
						if (!data.failed) continue;
						if (data.output && data.output.length > 0) {
							task.output = `\n\n${data.output}\n\n`;
						} else {
							task.output = `\n${"✗".red}  ${skillName}  —  (no output captured)\n`;
						}
					}

					task.output = `${" Test summary ".bold.bgWhite.black}\n\n${printSummaryTable(ctx.results)}\n\n`;

					if (Object.values(ctx.results).some((d) => d.failed)) {
						throw new Error(
							`Some tests failed. See output for details.\n`
						);
					}
				},
				rendererOptions: {
					bottomBar: Infinity,
					persistentOutput: true,
				},
			},
			{
				title: "Print coverage report",
				task: async (ctx, task) => {
					const rows = [];

					Object.entries(ctx.results).forEach(([skillName, data]) => {
						const pct = data.coverage?.totals?.percent_covered;
						rows.push([
							skillName.magenta,
							printCoverage(
								typeof pct === "number" ? pct : undefined
							),
							"",
						]);
						data.coverage?.files?.forEach((f) => {
							rows.push([
								` - ${f.name.cyan}`,
								printCoverage(f.rate),
								f.uncoveredLines.join(", "),
							]);
						});
					});

					const coverageTable = table(
						[
							[
								"Test".bold,
								"Line rate".bold,
								"Uncovered Lines".bold,
							],
							...rows,
						],
						{
							stringLength: (s) => stripAnsi(s).length,
							align: ["l", "c", "l"],
						}
					);
					task.output = `\n\n${" Coverage report ".bold.bgWhite.black}\n${addTableBorders(coverageTable).join("\n")}\n\n`;
				},
				rendererOptions: {
					bottomBar: Infinity,
					persistentOutput: true,
				},
			},
		],
		{
			concurrent: false,
			ctx: {
				pythonPath: resolvePython(), // the path to the Python executable
				skillDirectory: (skillName) =>
					path.join(root, "skills", skillName), // the directory containing the skill's code
				testDirectory: (skillName) =>
					path.join(root, "skills", skillName, "tests"), // the directory containing the skill's tests
				scriptsDirectory: (skillName) =>
					path.join(root, "skills", skillName, "scripts"), // the directory containing the skill's scripts
				resultLog: (skillName) =>
					path.join(root, "reports", `${skillName}.jsonl`), // the file containing the skill's test results
				coverageReport: (skillName) =>
					path.join(root, "coverage", `${skillName}.xml`), // the file containing the skill's coverage report
				...argv,
			},
		}
	);

	return await tasks
		.run()
		.catch((e) => Promise.reject(new Error(e?.message ?? e)));
}

main().catch((err) => {
	console.error(err?.message ?? err);
	process.exit(1);
});

/* eslint-enable no-control-regex */
/* prettier-enable no-control-regex */

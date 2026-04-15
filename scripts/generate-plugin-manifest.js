import fs from "fs";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { parseFrontmatter, getSkills } from "./parse-skills.js";
import "colors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const skillsDir = path.join(root, "skills");

/**
 * Process a skill directory and return its ID, name, description, and path.
 * @param {import("fs").Dirent} entry
 * @returns {Promise<{id: string, name: string, description: string, path: string}>}
 */
async function processSkill(entry) {
	const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
	if (fs.existsSync(skillMdPath)) {
		const content = await readFile(skillMdPath, "utf-8")
			.then((content) => parseFrontmatter(content))
			.catch((err) => Promise.reject(new Error(`Failed to read ${skillMdPath.cyan}: ${err.message}`)));

		return Promise.resolve({
			id: entry.name,
			name: content.name || entry.name,
			description: content.description || "",
			path: entry.name,
		});
	}

	return Promise.resolve({
		id: entry.name,
		name: entry.name,
		description: "",
		path: entry.name,
	});
}

async function main() {
	const pkg = await readFile(path.join(root, "package.json"), "utf-8").then((content) => JSON.parse(content));
	if (!pkg) {
		return Promise.reject(new Error(`Failed to read package.json in ${path.relative(root, "package.json").cyan}`));
	}

	const skills = await getSkills(processSkill).then((skills) => skills.sort((a, b) => a.id.localeCompare(b.id))).catch((err) => Promise.reject(new Error(`Failed to get skills: ${err.message}`)));

	// ── .claude-plugin/plugin.json ─────────────────────────────────────────
	// Defines this repo as a Claude Code plugin. Describes the default
	// "install all" surface. Skills are listed under components.skills.
	const pluginJson = {
		name: "agent-skills",
		display_name: pkg.name,
		description: pkg.description,
		version: pkg.version,
		components: {
			skills: skills.map((s) => s.path),
		},
	};

	const pluginDir = path.join(root, ".claude-plugin");
	if (!fs.existsSync(pluginDir)) {
		fs.mkdirSync(pluginDir, { recursive: true });
	}

	// ── marketplace.json ───────────────────────────────────────────────────
	// Defines the marketplace catalog. Exposes two install surfaces:
	//   1. "agent-skills" — installs every skill at once
	//   2. One entry per individual skill for selective installs
	const marketplaceJson = {
		name: "agent-skills",
		display_name: pkg.name,
		plugins: [
			{
				id: "agent-skills",
				name: "All Skills",
				description: `All ${skills.length} available agent skills from ${pkg.name}`,
				components: {
					skills: skills.map((s) => s.path),
				},
			},
			...skills.map((skill) => ({
				id: skill.id,
				name: skill.name,
				description: skill.description,
				components: {
					skills: [skill.path],
				},
			})),
		],
	};

	return Promise.all([
		writeFile(
			path.join(pluginDir, "plugin.json"),
			JSON.stringify(pluginJson, null, 2) + "\n",
			"utf-8"
		).then(() => {
			console.log(`${"✓".green} ${'.claude-plugin/plugin.json'.cyan} generated with: ${skills.map((s) => s.id.magenta).join(", ")}`);
		}).catch((err) => Promise.reject(new Error(`Failed to write ${'.claude-plugin/plugin.json'.cyan} in ${path.relative(root, pluginDir).cyan}: ${err.message}`))),
		writeFile(
			path.join(root, "marketplace.json"),
			JSON.stringify(marketplaceJson, null, 2) + "\n",
			"utf-8"
		).then(() => {
			console.log(`${"✓".green} ${'marketplace.json'.cyan} generated with: ${skills.map((s) => s.id.magenta).join(", ")}`);
		}).catch((err) => Promise.reject(new Error(`Failed to write ${'marketplace.json'.cyan} in ${path.relative(root, "marketplace.json").cyan}: ${err.message}`))),
	]).then(() => Promise.resolve(skills)).catch((err) => Promise.reject(new Error(`Failed to generate plugin manifest: ${err.message}`)));
}

main().then(() => {
	process.exit(0);
}).catch((err) => {
	console.error(`${"✗".red} ${err.message}`);
	process.exit(1);
});

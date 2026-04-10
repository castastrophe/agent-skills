import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const skillsDir = path.join(root, "skills");

/**
 * Parse YAML frontmatter from a SKILL.md file.
 */
function parseFrontmatter(content) {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};

	return Object.fromEntries(
		match[1].split("\n").flatMap((line) => {
			const [key, ...rest] = line.split(":");
			if (!key || !rest.length) return [];
			return [[key.trim(), rest.join(":").trim().replace(/^["']|["']$/g, "")]];
		}),
	);
}

/**
 * Discover all skills and return their metadata.
 */
function discoverSkills() {
	if (!fs.existsSync(skillsDir)) return [];

	return fs
		.readdirSync(skillsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
			const meta = fs.existsSync(skillMdPath)
				? parseFrontmatter(fs.readFileSync(skillMdPath, "utf-8"))
				: {};
			return {
				id: entry.name,
				name: meta.name || entry.name,
				description: meta.description || "",
				path: `skills/${entry.name}`,
			};
		})
		.sort((a, b) => a.id.localeCompare(b.id));
}

function main() {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
	const skills = discoverSkills();
	const skillPaths = skills.map((s) => s.path);

	// ── .claude-plugin/plugin.json ─────────────────────────────────────────
	// Defines this repo as a Claude Code plugin. Describes the default
	// "install all" surface. Skills are listed under components.skills.
	const pluginJson = {
		name: "agent-skills",
		display_name: pkg.name,
		description: pkg.description,
		version: pkg.version,
		components: {
			skills: skillPaths,
		},
	};

	const pluginDir = path.join(root, ".claude-plugin");
	fs.mkdirSync(pluginDir, { recursive: true });
	fs.writeFileSync(
		path.join(pluginDir, "plugin.json"),
		JSON.stringify(pluginJson, null, 2) + "\n",
		"utf-8",
	);
	console.log(".claude-plugin/plugin.json written");

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
					skills: skillPaths,
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

	fs.writeFileSync(
		path.join(root, "marketplace.json"),
		JSON.stringify(marketplaceJson, null, 2) + "\n",
		"utf-8",
	);
	console.log(`marketplace.json written with ${skills.length} skill(s): ${skills.map((s) => s.id).join(", ")}`);
}

main();

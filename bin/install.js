#!/usr/bin/env node
/**
 * @allons-y/agent-skills installer
 *
 * This script is used to install skills into the Claude Code plugin system.
 * Usage:
 *   npx @allons-y/agent-skills                         List available skills
 *   npx @allons-y/agent-skills <skill-name>            Install a specific skill
 *   npx @allons-y/agent-skills --all                   Install all skills
 *   npx @allons-y/agent-skills <skill-name> --dir <p>  Install to a custom path
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import AdmZip from "adm-zip";
import "colors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(__dirname, "..", "skills");
const defaultInstallDir = path.join(os.homedir(), ".claude", "skills");

/**
 * Parse YAML frontmatter from a SKILL.md file.
 */
function parseSkillMeta(skillName) {
	const mdPath = path.join(skillsDir, skillName, "SKILL.md");
	if (!fs.existsSync(mdPath)) return { name: skillName, description: "" };

	const content = fs.readFileSync(mdPath, "utf-8");
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return { name: skillName, description: "" };

	const meta = Object.fromEntries(
		match[1].split("\n").flatMap((line) => {
			const [key, ...rest] = line.split(":");
			if (!key || !rest.length) return [];
			return [[key.trim(), rest.join(":").trim().replace(/^["']|["']$/g, "")]];
		}),
	);

	return { name: meta.name || skillName, description: meta.description || "" };
}

/**
 * List available skills and their descriptions.
 */
function listSkills() {
	if (!fs.existsSync(skillsDir)) {
		console.log("✗".red + "  No skills directory found. The package may not have been published yet.");
		process.exit(1);
	}

	const skills = fs
		.readdirSync(skillsDir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => parseSkillMeta(e.name));

	if (skills.length === 0) {
		console.log("!".yellow + "  No skills found.");
		return;
	}

	console.log(`\n${'Available skills'.bold} (${skills.length} total)\n`);
	for (const skill of skills) {
		console.log(`  ${skill.name.cyan}`);
		if (skill.description) {
			// Wrap description at ~80 chars, indented to align with name
			const words = skill.description.split(" ");
			const lines = [];
			let line = "";
			for (const word of words) {
				if (line.length + word.length > 76) {
					lines.push(line.trimEnd());
					line = word + " ";
				} else {
					line += word + " ";
				}
			}
			if (line.trim()) lines.push(line.trimEnd());
			console.log(`    ${lines.join("\n    ")}`.dim);
		}
		console.log();
	}

	console.log(`${'Install a skill:'.dim}  npx @allons-y/agent-skills <skill-name>`);
	console.log(`${'Install all:'.dim}      npx @allons-y/agent-skills --all\n`);
}

/**
 * Install a single skill by name.
 */
function installSkill(skillName, installDir) {
	const zipPath = path.join(skillsDir, `${skillName}.zip`);
	const destPath = path.join(installDir, skillName);

	if (!fs.existsSync(zipPath)) {
		// Fall back to directory copy if zip isn't present (dev/local usage)
		const srcPath = path.join(skillsDir, skillName);
		if (!fs.existsSync(srcPath)) {
			console.log("✗".red + `  Skill "${skillName}" not found. Run without arguments to list available skills.`);
			process.exit(1);
		}
		console.log("!".yellow + `  No zip found for "${skillName}" — copying source directory instead.`);
		copyDir(srcPath, destPath);
	} else {
		fs.mkdirSync(destPath, { recursive: true });
		const zip = new AdmZip(zipPath);
		zip.extractAllTo(destPath, true);
	}

	const meta = parseSkillMeta(skillName);
	console.log("✓".green + `  Installed ${meta.name.bold} → ${destPath.dim}`);
}

/**
 * Recursively copy a directory (fallback for development installs).
 */
function copyDir(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcEntry = path.join(src, entry.name);
		const destEntry = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDir(srcEntry, destEntry);
		} else {
			fs.copyFileSync(srcEntry, destEntry);
		}
	}
}

function main() {
	const args = process.argv.slice(2);
	const installAll = args.includes("--all");
	const dirFlag = args.indexOf("--dir");
	const installDir = dirFlag !== -1 ? args[dirFlag + 1] : defaultInstallDir;
	const skillArg = args.find((a) => !a.startsWith("--"));

	if (!skillArg && !installAll) {
		listSkills();
		return;
	}

	if (!fs.existsSync(installDir)) {
		fs.mkdirSync(installDir, { recursive: true });
		console.log("→".cyan + `  Created install directory: ${installDir}`);
	}

	if (installAll) {
		const skills = fs
			.readdirSync(skillsDir, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);

		console.log(`\nInstalling ${skills.length} skill(s) to ${installDir.dim}\n`);
		for (const skill of skills) {
			installSkill(skill, installDir);
		}
		console.log(`\n${'Done!'.green.bold} Restart Claude to activate the skills.\n`);
	} else {
		console.log();
		installSkill(skillArg, installDir);
		console.log(`\n${'Done!'.green.bold} Restart Claude to activate the skill.\n`);
	}
}

main();

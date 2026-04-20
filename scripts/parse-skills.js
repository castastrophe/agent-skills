import fs from "fs";
import { readdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import "colors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const skillsDir = path.join(root, "skills");

/**
 * Parse the YAML frontmatter from a SKILL.md file.
 * Returns an object with the frontmatter key/value pairs.
 */
export function parseFrontmatter(content) {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};

	return Object.fromEntries(
		match[1].split("\n").flatMap((line) => {
			const [key, ...rest] = line.split(":");
			if (!key || !rest.length) return [];
			return [
				[
					key.trim(),
					rest
						.join(":")
						.trim()
						.replace(/^["']|["']$/g, ""),
				],
			];
		})
	);
}


/**
 * Read all skill directories and return their names and metadata.
 * @param {Function} callback - A callback function to process each skill directory.
 * @returns {Promise<any[]>}
 */
export async function getSkills(callback = (entry) => entry) {
	if (!fs.existsSync(skillsDir)) return Promise.resolve([]);

	// Read all skill directories and return their names and metadata
	const skillDirectories = await readdir(skillsDir, { withFileTypes: true })
		.then((entries) => entries.filter((entry) => entry.isDirectory()))
		.catch((err) => Promise.reject(new Error(`Failed to read ${path.relative(root, skillsDir).cyan}: ${err.message}`)));

	return Promise.all(skillDirectories.map(callback)).catch((err) => Promise.reject(new Error(`Failed to get skills: ${err.message}`)));
}

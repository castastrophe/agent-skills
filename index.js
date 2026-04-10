import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const skillsDir = path.join(__dirname, "skills");

/**
 * Returns a list of all available skills with their metadata.
 */
export function getSkills() {
	if (!fs.existsSync(skillsDir)) {
		return [];
	}

	return fs
		.readdirSync(skillsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const skillName = entry.name;
			const skillPath = path.join(skillsDir, skillName);
			const skillMdPath = path.join(skillPath, "SKILL.md");
			const zipPath = path.join(skillsDir, `${skillName}.zip`);

			let description = "";
			if (fs.existsSync(skillMdPath)) {
				const content = fs.readFileSync(skillMdPath, "utf-8");
				// Simple regex to extract description from frontmatter
				const match = content.match(/description:\s*["'](.*?)["']/);
				if (match) {
					description = match[1];
				}
			}

			return {
				name: skillName,
				path: skillPath,
				zipPath: fs.existsSync(zipPath) ? zipPath : null,
				description,
				mdPath: skillMdPath,
			};
		});
}

export default {
	getSkills,
};

import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

const skillsDir = "skills";
const root = process.cwd();

function main() {
	if (!fs.existsSync(path.resolve(root, skillsDir))) {
		console.error(`Directory ${path.resolve(root, skillsDir)} not found.`);
		process.exit(1);
	}

	const entries = fs.readdirSync(path.resolve(root, skillsDir), {
		withFileTypes: true,
	});
	const skillDirs = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);

	skillDirs.forEach((skillName) => {
		const skillPath = path.resolve(root, skillsDir, skillName);
		const outputPath = path.resolve(root, `${skillName}.zip`);

		console.log(`Zipping ${outputPath}...`);

		try {
			const zip = new AdmZip();

			// Add the entire directory content to the zip root
			// false indicates we don't want to include the parent folder name in the zip
			zip.addLocalFolder(skillPath);

			// Write the zip file
			zip.writeZip(outputPath);

			console.log(`Successfully created ${outputPath}`);
		} catch (err) {
			console.error(`Failed to zip ${outputPath}:`, err.message);
			process.exit(1);
		}
	});

	console.log("\nAll skills zipped successfully.");
}

main();

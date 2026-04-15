
import path from "path";
import AdmZip from "adm-zip";

import { getSkills } from "./parse-skills.js";

import "colors";

/**
 *
 * @param {import("fs").Dirent} pkg
 * @returns {Promise<void>}
 */
async function bundlePackage(pkg) {
	const zipPath = path.join(pkg.parentPath, pkg.name, `skill-${pkg.name}.zip`);

	try {
		const zip = new AdmZip();

		// Add the entire directory content to the zip root
		// false indicates we don't want to include the parent folder name in the zip
		zip.addLocalFolder(path.join(pkg.parentPath, pkg.name));

		// Write the zip file
		zip.writeZip(zipPath);

		console.log(`${"✓".green} Successfully bundled ${pkg.name.magenta}`);
	} catch (err) {
		return Promise.reject(new Error(`Failed to bundle ${pkg.name.magenta}: ${err.message}`));
	}
}

async function main() {
	return getSkills(bundlePackage).catch((err) => Promise.reject(new Error(`Failed to get skills: ${err.message}`)));
}

main().catch((err) => {
	console.error(`${"✗".red} ${err.message}`);
	process.exit(1);
}).then(() => {
	console.log(`${"✓".green} All skills bundled successfully.`);
	process.exit(0);
});

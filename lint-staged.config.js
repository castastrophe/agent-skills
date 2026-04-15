export default {
	"*.{py}": [
		"prettier --no-error-on-unmatched-pattern --ignore-unknown --log-level silent --write --config .prettierrc",
	],
	"package.json": ["prettier-package-json --write"],
	"*.{js,mjs,cjs}": ["eslint --fix --format stylish"],
	"*.json": ["eslint --fix --format stylish"],
	"*.md": ["eslint --fix --format stylish"],
	"*.css": ["eslint --fix --format stylish"],
};

export default {
	"*.{js,md,mdx,py}": [
		"prettier --no-error-on-unmatched-pattern --ignore-unknown --log-level silent --write --config .prettierrc",
	],
	"package.json": ["prettier-package-json --write"],
};

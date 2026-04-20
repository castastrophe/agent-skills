# Contributing to @allons-y/agent-skills

Allons-y — let's go! Contributions of all kinds are welcome: bug fixes, new features, documentation improvements, and test coverage. If you're unsure whether your idea fits the project, open an issue first and we'll figure it out together.

## Before you start

1. **Search existing issues** before opening a new one — your bug or idea may already be in progress.
2. **Open an issue** to discuss non-trivial changes before writing code. This saves everyone time and avoids PRs that can't be merged.
3. **Fork the repository** and clone your fork locally:
    ```sh
    git clone https://github.com/<your-username>/agent-skills.git
    cd agent-skills
    yarn install
    ```

## Development workflow

### Branching

Create a branch from `main` that describes your change:

```sh
git checkout -b fix/gh-notif-truncation
git checkout -b feat/new-useful-skill
```

### Adding a New Skill

Each skill lives in its own directory under `skills/`. A standard skill should include:

1. **`SKILL.md`**: Documentation following the required format (including YAML frontmatter with `name` and `description`).
2. **`scripts/`**: The implementation scripts (usually Python).
3. **`requirements.txt`**: List of Python dependencies.
4. **`tests/`**: A pytest suite.
5. **`evals/evals.json`**: Eval prompts validating skill triggering behavior (see [Evals](#evals) below).

### Workspace structure

This repo is a Yarn workspaces monorepo — each skill under `skills/` is a workspace member with its own `package.json`. To list all workspaces:

```sh
yarn workspaces list
```

Each skill needs a `package.json` with `"private": true` to prevent accidental publishing. All Python commands use `uv run` so dependency resolution is automatic:

```json
{
	"name": "@allons-y/skill-<skill-name>",
	"version": "0.0.0",
	"private": true,
	"description": "One-sentence description",
	"scripts": {
		"test": "uv run pytest tests/ --tb=short",
		"lint": "uv run ruff check .",
		"format": "uv run ruff format --check .",
		"typecheck": "uv run mypy --config-file pyproject.toml .",
		"security": "uv run bandit -r scripts/"
	}
}
```

Run `yarn install` after adding a new skill so Yarn registers the new workspace.

### Running commands per workspace

Use `yarn workspace` to run a script inside a specific skill without `cd`-ing into it:

```sh
yarn workspace @allons-y/skill-gh-notification-summary test
yarn workspace @allons-y/skill-gh-notification-summary lint
yarn workspace @allons-y/skill-gh-notification-summary typecheck
```

To run a command across all workspaces at once:

```sh
yarn workspaces foreach -A run test
yarn workspaces foreach -A run lint
```

The root `yarn test` and `yarn evals` scripts continue to orchestrate everything — the workspace commands are useful when you want to target a single skill quickly.

### Python environment setup

This project uses [**uv**](https://docs.astral.sh/uv/) to manage Python dependencies. `uv run` auto-creates and caches a virtual environment per project, so there's no manual `.venv` activation step.

**Install uv** (one-time):

```sh
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Or via Homebrew
brew install uv
```

That's it — `uv run pytest`, `uv run ruff`, etc. will automatically resolve dependencies from each skill's `requirements.txt`.

> **Fallback**: If you prefer not to install `uv`, the test runner (`scripts/run-tests.js`) also supports a repo-root `.venv` or bare `python3` on PATH. However, `uv` is the recommended and documented approach.

### Running tests

```sh
yarn test                      # all skills, in parallel
yarn test <skill-name>         # single skill
```

`PYTHONPATH` is set automatically. To invoke `pytest` directly (useful for passing extra flags):

```sh
PYTHONPATH=$(pwd)/skills/<skill-name> uv run pytest skills/<skill-name>/tests/
```

### Linting and formatting

All linters are included in each skill's `requirements.txt`. Run them from the repo root:

```sh
uv run ruff check skills/<skill-name>           # lint
uv run ruff format --check skills/<skill-name>  # format check (omit --check to auto-fix)
uv run mypy --config-file skills/<skill-name>/pyproject.toml skills/<skill-name>  # type check
uv run bandit -r skills/<skill-name>            # security scan
```

Or use the workspace scripts:

```sh
yarn workspace @allons-y/skill-<skill-name> lint
yarn workspace @allons-y/skill-<skill-name> typecheck
yarn workspace @allons-y/skill-<skill-name> security
```

### Evals

Each skill must include an `evals/evals.json` file that validates the skill triggers (and doesn't trigger) on realistic prompts.

**Running evals locally** requires an Anthropic API key. The runner sends each prompt to Claude with the skill's `SKILL.md` as a system prompt and the Python scripts registered as callable tools, then asserts that the correct tool was (or wasn't) called:

```sh
export ANTHROPIC_API_KEY=sk-ant-...

yarn evals                        # all skills
yarn evals gh-notification-summary  # single skill

# Use a different model (default: claude-haiku-4-5)
ANTHROPIC_MODEL=claude-opus-4-5 yarn evals
```

Evals also run on demand in CI via the [Evals workflow](../../actions/workflows/evals.yml) (`Actions → Evals → Run workflow`).

**The format is:**

```json
{
	"skill_name": "<skill-name>",
	"evals": [
		{
			"id": 1,
			"prompt": "natural-language prompt that should trigger this skill",
			"expected_output": "description of what the agent should do",
			"files": []
		},
		{
			"id": 2,
			"prompt": "prompt that should NOT trigger this skill",
			"expected_output": "Does NOT trigger this skill. Reason why.",
			"files": [],
			"should_trigger": false
		}
	]
}
```

Include at least two positive triggers and two negative (false-positive) cases. See [`skills/gh-notification-summary/evals/evals.json`](skills/gh-notification-summary/evals/evals.json) for a complete example.

### Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/). The format is:

```md
<type>(<optional scope>): <short description>

[optional body]

[optional footer(s)]
```

Common types:

| Type       | When to use                                 |
| ---------- | ------------------------------------------- |
| `feat`     | A new feature (triggers a minor release)    |
| `fix`      | A bug fix (triggers a patch release)        |
| `docs`     | Documentation changes only                  |
| `test`     | Adding or updating tests                    |
| `refactor` | Code restructuring without behaviour change |
| `chore`    | Tooling, config, dependency updates         |

### Pull requests

- Keep PRs focused — one logical change per PR.
- Every new skill or changed behavior **must** include tests and evals.
- PR titles should follow Conventional Commits.
- Fill out the PR description — explain the "why", not just the "what".

## Project structure

```md
agent-skills/ # Root workspace (publishes to npm)
├── package.json # Root — workspaces: ["skills/*"]
├── index.js # Exports getSkills()
├── bin/install.js # npx installer CLI
├── scripts/ # Root orchestration scripts
│ ├── run-tests.js # Parallel pytest runner
│ ├── run-evals.js # LLM eval runner
│ ├── bundle-skills.js # Zips skills for distribution
│ ├── generate-agent-yaml.js # Generates agent.yaml
│ └── generate-plugin-manifest.js # Generates marketplace.json
├── skills/ # Yarn workspace members
│ └── <skill-name>/ # Each skill is a workspace
│ ├── package.json # private: true, skill-level scripts
│ ├── pyproject.toml # mypy config
│ ├── requirements.txt # Python dependencies
│ ├── SKILL.md # Skill documentation and metadata
│ ├── scripts/ # Python implementation
│ ├── tests/ # pytest suite
│ └── evals/ # Eval prompts (evals.json)
└── .github/
└── workflows/ # CI automation
```

## Release process

When publishing to npm, a `prepublishOnly` hook automatically zips each skill into a `<skill-name>.zip` asset within the `skills/` directory. These assets are ignored by Git but included in the npm package for distribution.

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/) Code of Conduct. By participating you agree to uphold a welcoming and respectful environment for everyone.

If you experience or witness unacceptable behaviour, please report it by opening a private issue or emailing [castastrophe@users.noreply.github.com](mailto:castastrophe@users.noreply.github.com).

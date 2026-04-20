# @allons-y/agent-skills

A Yarn workspaces monorepo of Claude agent skills. Each skill under `skills/` is a workspace member with its own `package.json` (`private: true`), `SKILL.md`, implementation scripts, and test suite. Most skills use Python (`requirements.txt`, `pyproject.toml`, `pytest`); some (for example `gh-notification-summary`) are **Node.js-only** (`node --test`, ESLint/Prettier). Only the root package publishes to npm — skills are bundled as `.zip` files during publish for drop-in installation.

## Repository layout

```sh
package.json                    # Root workspace — workspaces: ["skills/*"]
index.js                        # Node.js entry point — exports getSkills()
bin/install.js                  # npx installer CLI
scripts/
  run-tests.js                  # Runs each skill's `yarn workspace … test` (pytest or Node + c8)
  run-evals.js                  # LLM eval runner (Anthropic API)
  bundle-skills.js              # Bundles each skill into a .zip for distribution
  generate-agent-yaml.js        # Regenerates agent.yaml from the skills directory
  generate-plugin-manifest.js   # Regenerates .claude-plugin/ and marketplace.json
skills/                         # Yarn workspace members
  <skill-name>/
    package.json                # private: true — skill-level scripts (test, lint, etc.)
    SKILL.md                    # YAML frontmatter (name, description) + usage docs
    pyproject.toml              # (Python skills) mypy configuration
    requirements.txt            # (Python skills) dependencies — if absent, `run-tests.js` treats the skill as Node-tested
    scripts/                    # Implementation (Python or Node)
    tests/                      # pytest or `node --test` (`.js`) suite
    evals/                      # Eval prompts (evals.json)
agent.yaml                      # Auto-generated skill manifest (do not edit by hand)
```

## Common commands

```bash
yarn test                       # Run all skill test suites (parallel)
yarn test <skill-name>          # Run tests for a single skill
yarn evals                      # Run LLM evals for all skills
yarn bundle                     # Bundle skills into .zip assets (runs automatically on publish)
yarn generate:agent-yaml        # Regenerate agent.yaml
yarn generate:plugin-manifest   # Regenerate .claude-plugin/plugin.json and marketplace.json
yarn release                    # Cut a release via semantic-release
```

## Workspace commands

Target a single skill without `cd`-ing into it:

```bash
yarn workspace @allons-y/skill-gh-notification-summary test
yarn workspace @allons-y/skill-gh-notification-summary lint
```

Run across all workspaces:

```bash
yarn workspaces foreach -A run test
yarn workspaces foreach -A run lint
```

## Adding a new skill

1. Create a directory under `skills/<skill-name>/`.
2. Add a `package.json` with `"private": true`. All Python commands use `uv run`:
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
3. Add a `SKILL.md` with YAML frontmatter:
    ```yaml
    ---
    name: skill-name
    description: "One-sentence description. Include trigger phrases here."
    ---
    ```
4. Add implementation scripts under `scripts/`.
    - If leveraging python, list dependencies in `requirements.txt` and add a `pyproject.toml` for mypy config.
5. Write a full test suite under `tests/` — tests must not require live credentials.
    - If leveraging python, use `pytest`.
6. Run `yarn install` to register the new workspace, then `yarn test` to verify.

## Skill naming

Use lowercase hyphenated names that match the directory name (e.g., `gh-notification-summary`). The `name` field in `SKILL.md` frontmatter must match the directory name exactly.

## Languages and tooling

- **Node.js ≥ 24** (use `nvm use` — version pinned in `.nvmrc`)
- **Yarn 4** (workspaces monorepo, version pinned in `packageManager` field)
- **[uv](https://docs.astral.sh/uv/)** for Python package and environment management — all Python commands in `package.json` use `uv run`
- **Python 3.13** for skill implementations (managed by `uv`)
- **pytest + pytest-mock + pytest-cov + pytest-reportlog** for skill tests
- **ruff** for Python linting and formatting
- **mypy** for Python type checking (config in each skill's `pyproject.toml`)
- **bandit** for Python security scanning
- **ESLint + Prettier** for JavaScript linting and formatting
- **Conventional Commits** enforced by commitlint + husky

Note: not all skills have to use python for scripting. If other languages or tools are added however, they must be added to the documentation and toolchain.

## Commits

Commit messages will populate the changelog so it's important that their description be clear and succinct as well as written in a customer-focused way. If a pull request has multiple commits, they must be squashed before merging into `main` to ensure a clean release message.

### Do

```sh
feat(gh-notification-summary): creates a new skill for summarizing new notifications

Stop letting your GitHub notification inbox become a graveyard. This skill gives Claude the ability to fetch, display, and act on your unread GitHub notifications — all from a single prompt.

What it does:

- Opens an interactive local dashboard at http://localhost:8000 showing each unread notification as a card, complete with labels, latest comments, and ready-to-paste action commands
- Unsubscribes you from noisy threads (/unsub 4821) without requiring you to navigate GitHub
- Marks individual notifications or your entire inbox as done in one shot
Works with any repo — pass a repo explicitly or set GITHUB_REPO as your default

Say anything like "check my GitHub notifications", "what's in my GitHub inbox?", "get me off that thread", or "mark all done" — Claude will know what to do.

Pairs well with a morning routine prompt — ask Claude to open your dashboard, summarize what needs attention, and clear the rest.
```

## Don't

- `wip`
- `fix stuff`
- `feat: updates`

## Release process

Releases are fully automated via `semantic-release`. Merging to `main` triggers:

1. Version bumps based on commit messages
2. `prepublishOnly`: skills are zipped and dynamic assets are regenerated
3. Changelog update, npm publish, and a `chore(release):` commit back to `main`

Do not manually update `package.json` version or `CHANGELOG.md`.

## What NOT to do

- Do not edit `agent.yaml`, `marketplace.json`, or `.claude-plugin/plugin.json` by hand — all three are auto-generated during publish and committed by semantic-release.
- Do not commit `.zip` files — they are Git-ignored and generated on publish.
- Do not add secrets or real credentials to tests — mock all external API calls.

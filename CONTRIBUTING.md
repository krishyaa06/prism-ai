# Contributing to prism-ai

Thanks for taking the time to contribute! prism-ai is an Android app by [Prism Protocol](https://github.com/krishyaa06).

## Getting started

```bash
git clone https://github.com/krishyaa06/prism-ai.git
cd prism-ai
./gradlew assembleDebug
```

## Before you open a pull request

Make sure everything passes locally:

```bash
./gradlew assembleDebug
```

## Guidelines

- Never commit API keys or model files; keep keys in the in-app token store.
- Read [`docs/ACCEPTABLE_USE.md`](docs/ACCEPTABLE_USE.md) before adding new agent tools.
- Keep pull requests small and focused — one feature or fix per PR.
- Update the README when you change behaviour, flags or options.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add --json output
fix: handle empty input
docs: clarify install steps
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`. Add a short entry under **[Unreleased]** in [CHANGELOG.md](CHANGELOG.md) for user-facing changes.

## Reporting bugs & ideas

Open an [issue](https://github.com/krishyaa06/prism-ai/issues) with:

- what you expected vs. what happened
- steps to reproduce
- your OS, browser or Node.js version

**Security issues:** please don't open a public issue — contact the maintainer privately via [GitHub](https://github.com/krishyaa06).

## License

By contributing, you agree that your contributions will be licensed under the project's [license](LICENSE).

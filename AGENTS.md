# AGENTS.md

Guidelines for anyone, human or AI tool, working on Driver during the hackathon.

## How we work

- No merge requests. Push straight to `main`.
- Before every push: `git pull --rebase`, then `git push`. Don't create merge commits.
- Never force-push `main` (`git push --force` or `--force-with-lease`). If a push is rejected, pull with rebase and try again.
- Commit small and often, with a short message that says what changed.
- Split work by folder or file where you can, so two people rarely edit the same file. If you must change a shared file, pull first and push soon after.
- If a rebase hits a conflict in someone else's code, keep both changes where possible and tell that person.

## Testing

- Test locally before pushing. There is no CI: the project has no runners, so don't add a `.gitlab-ci.yml` (its pipelines would stay pending).
- Don't push code that breaks the build or startup for everyone else.

## Never commit

- Secrets of any kind: API keys, tokens, passwords, `.env` files, cloud or kube credentials. Use a local `.env` and add it to `.gitignore`.
- Company or customer data, including personal information.
- Large or generated files: build output, `node_modules`, virtual environments, datasets, videos. Add them to `.gitignore`.

## For AI tools

- Follow the rules above when committing or pushing for someone.
- Run `git pull --rebase` before pushing, and stop and ask the person if the rebase conflicts.
- Don't rewrite history on `main`, and don't delete other people's files without asking.

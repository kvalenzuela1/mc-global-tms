---
name: pr
description: Package a feature into its own git worktree, branch, and GitHub PR — the standard for this repo, one feature = one branch = one PR. Use when starting new work that should be isolated (especially when another tab/session may be editing the same working directory), when the user says "open a PR", "start a branch for this", or "ship this as its own PR", or when a chunk of work is done and ready to go up for review.
user-invocable: true
---

# /pr — one feature, one branch, one PR

Arguments passed: `$ARGUMENTS`

This repo is worked on from multiple Claude Code tabs pointed at the same
directory. `git stash`/branch switches in one tab can catch another tab's
in-progress files (this has actually happened — see git log context if asked).
**Worktrees are the fix**: each feature gets its own directory via
`EnterWorktree`, so tabs never share dirty state. Do not use raw
`git checkout -b` in the shared root for feature work — that's what this
skill replaces.

## Dispatch on `$ARGUMENTS`

- Empty, or `status` → **Status mode**
- Starts with `start` → **Start mode**, rest of the string is the description
- Starts with `finish` → **Finish mode**
- Anything else (a bare description, no recognized subcommand) → **Start mode**
  with the whole string as the description — this is the common case
  (`/pr carrier compliance UI polish`)

---

## Status mode

Report, don't act:

1. `pwd` — are we inside `.claude/worktrees/...` already, or in the shared root?
2. `git branch --show-current` and `git status`.
3. If in the shared root with uncommitted changes: name the files and say
   they aren't yet on a feature branch — recommend Start mode.
4. If in a worktree: show the branch name, how many commits ahead of
   `master`, and whether there are uncommitted changes — recommend Finish
   mode if things look ready.

---

## Start mode

Goal: get the described feature onto its own branch, in its own worktree,
with any relevant in-progress changes carried over — without touching files
that belong to a *different* piece of work sitting dirty in the same root.

1. **Derive the branch name**: `<milestone-slug>/<short-desc>`.
   - Read `CLAUDE.md`'s Milestones section. Find the entry marked
     `← current` (e.g. `### M4 — Carrier compliance  ← current`) and slugify
     it lowercase (`m4`). If the description clearly names a *different*
     milestone than the current one, use that milestone instead — don't
     force everything onto the current milestone.
   - If the work doesn't map to a milestone (pure chore/infra/UI polish not
     tied to a numbered milestone), use `chore`, `fix`, or `ui` as the prefix
     instead of a milestone slug — pick whichever reads truest.
   - `short-desc`: kebab-case, 2-5 words, from the user's description.
   - Confirm the final branch name with the user only if it's ambiguous;
     otherwise just state what you picked and proceed.

2. **Check for relevant uncommitted changes in the current (shared root)
   directory** via `git status`. This is the step that prevents repeating
   today's incident:
   - If there are no uncommitted changes, skip to step 3.
   - If there are uncommitted changes, look at *which files* they touch and
     judge whether they belong to the feature being started now, versus
     another task (this session's own recent edits vs. files neither you nor
     the user touched this conversation — those likely belong to another
     tab's session; **never** assume unfamiliar dirty files are yours to
     move). When in doubt, ask the user which files belong to this feature.
   - For the files that *do* belong to this feature: `git diff -- <those
     paths> > <scratchpad>/pr-<short-desc>.patch` (use the session's
     scratchpad directory, never `/tmp`). Do not touch or stage files
     outside that list.

3. **Create the worktree**: call `EnterWorktree` with
   `name: "<milestone-slug>/<short-desc>"`. This switches the session into
   the new worktree, branched fresh from `origin/master`.

4. **Apply carried-over changes**, if step 2 produced a patch:
   `git apply <scratchpad>/pr-<short-desc>.patch` inside the new worktree.
   Verify with `git status` that only the intended files changed.

5. Tell the user: the branch name, the worktree path, and that this session
   is now operating there. Continue whatever work was requested next.

---

## Finish mode

Run this once the feature is actually done and ready to go up for review.
Refuses to run from the shared root — a feature branch produced by Start
mode is required, so nothing ships straight from `master`.

1. Confirm we're in a worktree on a non-`master` branch (`git branch
   --show-current`). If not, stop and tell the user to run Start mode first
   (or point out they're on `master` in the shared root).

2. Run the repo's Definition of Done from `CLAUDE.md`:
   - `npm run test:offline` — must be green
   - `npm run typecheck` — must be clean
   - `npm run build` — note known pre-existing prerender flakiness on `/` and
     `/login` (`TypeError: a[d] is not a function`) unrelated to any feature
     work — don't block on that specific failure, but do block on anything
     else
   - `npm run verify:rls` — only if the change touches RLS, migrations, or
     permissions; skip otherwise and say why
   - If a schema changed, confirm a numbered migration exists under
     `supabase/migrations/`
   Stop and report if anything *relevant* is red — don't push broken work.

3. Stage only the files that are part of this feature (`git status` first,
   review before adding — never blind `git add -A`). Draft a commit message
   focused on why, following the repo's existing commit-message style
   (`git log` for tone). Create the commit per the standard git safety
   protocol (new commit, no `--amend`, no `--no-verify`, HEREDOC message,
   `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`).

4. Draft the PR title and body (Summary + Test plan, matching this repo's PR
   conventions). **Show the user the branch name, commit message, and PR
   title/body before pushing anything** — push and PR creation are visible,
   semi-hard-to-reverse actions, so get an explicit go-ahead here even though
   `/pr finish` itself was an explicit invocation.

5. On confirmation: `git push -u origin <branch>`, then
   `gh pr create --base master --title "..." --body "$(cat <<'EOF' ... EOF)"`.
   Report the PR URL.

6. Ask whether to keep the worktree (recommended until the PR merges — use
   `ExitWorktree action: "keep"` only if the user wants to leave this
   worktree/session now) or remove it (`ExitWorktree action: "remove"`,
   which will refuse on uncommitted changes unless `discard_changes: true` —
   never pass that without the user confirming there's nothing worth saving).

---

## Notes

- `gh` is authenticated in this environment (`kvalenzuela1`) — no auth setup
  needed.
- Never run Finish mode's push/PR-create step without showing the draft
  first, even though invoking `/pr` is itself explicit authorization for the
  skill's documented behavior — the confirmation is about the *content*
  (branch name, commit message, PR body), not permission to act at all.
- If the user is mid-conversation in the shared root with changes that were
  never split into a branch (e.g. this happened before the skill existed),
  Start mode's "carry over changes" step is exactly how to retroactively fix
  that — offer it.

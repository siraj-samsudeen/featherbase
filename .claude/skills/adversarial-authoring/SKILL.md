---
name: adversarial-authoring
description: Use when rules or instructions mention "adversarial-authoring", "adversarial authoring", "model council", "cross-model review", or "mixture of models", or when an artifact is complex or critical (security, permissions, data) — then propose it to the human first. Claude Code version - the reviewer is the Codex CLI when installed, otherwise a different Claude model than the author; runs only with the human's consent.
license: MIT
---

# Adversarial Authoring — Claude Code

Follow the OpenCode skill, `.opencode/skills/adversarial-authoring/SKILL.md` — its workflow,
council notes and guardrails — with the three differences below. They exist because a Claude
Code subagent can only run Claude models, so the OpenCode "council" of different model families
would collapse to one family.

## 1. Only with the human's consent

Never run it on your own, and never treat it as mandatory, even when a rule in
`openspec/config.yaml` names it. Propose it in one line when you judge the artifact complex or
critical — security, permissions, data, or a design that is expensive to undo — and say why.
Run it only if the human says yes. Without a yes, author the artifact normally.

## 2. The author

The `adversarial-author` subagent (`.claude/agents/`), on the session's model unless the human
names another. Note which model it ran on.

## 3. The reviewer — a different model family when possible

1. **Codex CLI, if installed** (`command -v codex`). Write the task context and the author's
   draft to a temporary file, and ask Codex for a read-only review in the output format of
   `.claude/agents/adversarial-reviewer.md`:

   ```bash
   codex exec --sandbox read-only -o <review-file> - < <prompt-file>
   ```

   Read the review from `<review-file>`.
2. **Otherwise, a different Claude model than the author.** Run the `adversarial-reviewer`
   subagent with a model override that differs from the author's (for example, `sonnet` when the
   author ran on `opus`, or the other way round). A reviewer on the author's own model is not
   adversarial: if no other model is available, say so and ask whether to continue with a
   single-model review.

If neither works, say that adversarial authoring could not be completed and ask whether to author
the artifact normally.

Record the author's and the reviewer's model (or "Codex CLI") in the council notes, under a
`## Council` line above `## Author Summary`.

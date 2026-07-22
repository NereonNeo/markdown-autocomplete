# MD Path Mentions Autocomplete

**A prompt without exact paths is a guessing game.**

You're writing a task for an AI assistant (Cursor, Copilot, Claude, GPT — doesn't matter), the task is big, there are lots of files involved. You open a `.md` file to structure your thoughts, and immediately hit the same old problem: how do you reference `src/components/UserProfile/index.tsx` without retyping the path by hand and getting the casing, dashes, or nesting wrong?

Usually you're stuck with two options:
1. Switch to the file explorer, copy the path, come back, paste it — ten times per prompt.
2. Type the path from memory — and the AI gets `src/component/UserProfil/idnex.tsx`, which leads nowhere.

**MD Path Mentions Autocomplete removes both options.** Type `@` right in your markdown file and get live autocomplete across every file and folder in the project. No typos, no window-switching, no guessing the project structure.

## How it works

- Type `@` in any `.md` file — a list of files and folders in the current workspace appears
- Keep typing to filter the list (`@src/ext` instantly finds `src/extension.ts`)
- The index is built once on activation and updates itself automatically when files are created or deleted — no manual rebuilds needed
- Noise directories (`node_modules`, `.git`, `dist`, `out`, `build`) are excluded from the index by default — the list only shows what actually matters

## Why this matters for prompts

When a task doesn't fit in a single chat message, a `.md` file is the natural way to describe it: context, steps, references to specific files and directories. But that file is only as useful as the paths inside it are accurate. One wrong path and the model works on the wrong file, loses context, or just can't find anything.

Autocomplete on `@` makes referencing a path as easy as mentioning a coworker in Slack. You write the task, and the system suggests exactly what you're pointing to — guaranteeing the path exists and is spelled correctly.

## Settings

| Setting                              | Default                                                                          | Description                                              |
| ------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `mdPathMentions.excludeGlobs`       | `["**/node_modules/**", "**/.git/**", "**/dist/**", "**/out/**", "**/build/**"]` | Glob patterns excluded from the index                     |
| `mdPathMentions.maxFiles`           | `8000`                                                                           | Limit of files in the index                                |
| `mdPathMentions.includeDirectories` | `true`                                                                           | Show directories in the autocomplete list                  |
| `mdPathMentions.maxSuggestions`     | `300`                                                                            | Maximum number of suggestions shown per autocomplete query |
| `mdPathMentions.trace`              | `false`                                                                          | Verbose debug logs in the `MD Path Mentions` Output channel |

## Commands

- **MD Path Mentions: Rebuild Index** (`mdPathMentions.rebuildIndex`) — force a rebuild of the file index

## Known limitations

- Only works in files with the `markdown` language mode
- `@` inside email addresses and similar constructs doesn't trigger autocomplete (it only fires after whitespace, start of line, or an opening character like `(`, `[`, `"`)

## License

MIT — see [LICENSE](./LICENSE)

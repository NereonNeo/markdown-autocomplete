import * as vscode from 'vscode';
import * as path from 'path';

// Регэксп для триггера: символ @ и то, что после него до курсора
// (буквы, цифры, /, ., -, _) — то есть похоже на путь
const MENTION_RE = /@([\w./-]*)$/;

// Символы перед "@", после которых мы считаем это упоминанием пути,
// а не частью слова — так `email@example.com` не триггерит автокомплит
const ALLOWED_CHAR_BEFORE_RE = /[\s([{"'`*_-]/;

const MAX_SUGGESTIONS_DEFAULT = 300;

interface IndexEntry {
  path: string;
  lowerPath: string;
  kind: vscode.CompletionItemKind;
}

class FileIndexer {
  private entries: IndexEntry[] = [];
  private building: Promise<void> | null = null;
  private rebuildTimer: NodeJS.Timeout | undefined;

  constructor(private readonly output: vscode.OutputChannel) {}

  private config() {
    const cfg = vscode.workspace.getConfiguration('mdPathMentions');
    return {
      excludeGlobs: cfg.get<string[]>('excludeGlobs', []),
      maxFiles: cfg.get<number>('maxFiles', 8000),
      includeDirectories: cfg.get<boolean>('includeDirectories', true),
      trace: cfg.get<boolean>('trace', false),
    };
  }

  private trace(message: string) {
    if (this.config().trace) {
      this.output.appendLine(`[debug] ${message}`);
    }
  }

  async build(): Promise<void> {
    // не даём двум построениям индекса выполняться параллельно
    if (this.building) {
      return this.building;
    }
    this.building = this._build();
    try {
      await this.building;
    } finally {
      this.building = null;
    }
  }

  private async _build(): Promise<void> {
    const { excludeGlobs, maxFiles, includeDirectories } = this.config();
    const exclude = excludeGlobs.length > 0 ? `{${excludeGlobs.join(',')}}` : undefined;

    const uris = await vscode.workspace.findFiles('**/*', exclude, maxFiles);

    const dirs = new Set<string>();
    const entries: IndexEntry[] = [];

    for (const uri of uris) {
      const rel = vscode.workspace.asRelativePath(uri, false);
      entries.push({ path: rel, lowerPath: rel.toLowerCase(), kind: vscode.CompletionItemKind.File });

      if (includeDirectories) {
        // накапливаем все промежуточные директории пути,
        // чтобы "src/components/Foo.tsx" дал и "src", и "src/components"
        let dir = path.dirname(rel);
        while (dir && dir !== '.' && !dirs.has(dir)) {
          dirs.add(dir);
          dir = path.dirname(dir);
        }
      }
    }

    for (const d of dirs) {
      entries.push({ path: d, lowerPath: d.toLowerCase(), kind: vscode.CompletionItemKind.Folder });
    }

    this.entries = entries;
    this.output.appendLine(
      `[md-path-mentions] Индекс: ${uris.length} файлов, ${dirs.size} директорий`
    );
  }

  // дебаунс: FileSystemWatcher может стрелять пачками при git checkout/npm install
  scheduleRebuild() {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
    }
    this.rebuildTimer = setTimeout(() => {
      this.build();
    }, 500);
  }

  watch(context: vscode.ExtensionContext) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    watcher.onDidCreate(() => this.scheduleRebuild());
    watcher.onDidDelete(() => this.scheduleRebuild());
    // onDidChange не подписываем — переименования/содержимое не меняют список путей
    context.subscriptions.push(watcher);

    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mdPathMentions')) {
        this.build();
      }
    });
    context.subscriptions.push(configWatcher);
  }

  // Возвращает записи, отфильтрованные по уже введённому тексту, без
  // материализации CompletionItem — фильтрация по строке намного дешевле,
  // чем создание объектов для всего индекса на каждое нажатие клавиши.
  queryEntries(typed: string, maxResults: number): { entries: IndexEntry[]; truncated: boolean } {
    const needle = typed.toLowerCase();
    const matched: IndexEntry[] = [];
    let truncated = false;

    for (const entry of this.entries) {
      if (needle.length === 0 || entry.lowerPath.includes(needle)) {
        if (matched.length >= maxResults) {
          truncated = true;
          break;
        }
        matched.push(entry);
      }
    }

    return { entries: matched, truncated };
  }
}

class PathCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly indexer: FileIndexer,
    private readonly output: vscode.OutputChannel
  ) {}

  private trace(message: string) {
    if (vscode.workspace.getConfiguration('mdPathMentions').get<boolean>('trace', false)) {
      this.output.appendLine(`[debug] ${message}`);
    }
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionList | undefined {
    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    const match = linePrefix.match(MENTION_RE);
    this.trace(`linePrefix="${linePrefix}" matched=${!!match}`);
    if (!match) {
      return undefined;
    }

    // не триггеримся посреди слова/email — только после пробела, начала
    // строки или одного из "открывающих" символов
    const charBeforeAtIndex = linePrefix.length - match[0].length - 1;
    const charBeforeAt = charBeforeAtIndex >= 0 ? linePrefix[charBeforeAtIndex] : undefined;
    if (charBeforeAt !== undefined && !ALLOWED_CHAR_BEFORE_RE.test(charBeforeAt)) {
      return undefined;
    }

    const typed = match[1]; // без "@" — само слово-путь после него
    const range = new vscode.Range(position.translate(0, -typed.length), position);

    const maxResults = vscode.workspace
      .getConfiguration('mdPathMentions')
      .get<number>('maxSuggestions', MAX_SUGGESTIONS_DEFAULT);

    const { entries, truncated } = this.indexer.queryEntries(typed, maxResults);
    this.trace(`matched entries=${entries.length} truncated=${truncated}`);

    const items = entries.map(({ path: p, kind }) => {
      const item = new vscode.CompletionItem(p, kind);
      item.insertText = p;
      item.filterText = p;
      item.range = range;
      item.detail = kind === vscode.CompletionItemKind.Folder ? 'папка' : undefined;
      return item;
    });

    // isIncomplete=true сообщает VSCode перезапросить провайдера при
    // дальнейшем вводе, а не фильтровать усечённый список на клиенте
    return new vscode.CompletionList(items, truncated);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('MD Path Mentions');
  context.subscriptions.push(output);

  const indexer = new FileIndexer(output);
  indexer.build();
  indexer.watch(context);

  const provider = vscode.languages.registerCompletionItemProvider(
    { language: 'markdown' },
    new PathCompletionProvider(indexer, output),
    '@'
  );
  context.subscriptions.push(provider);

  // команда для ручного форс-ребилда индекса, если что-то разъехалось
  context.subscriptions.push(
    vscode.commands.registerCommand('mdPathMentions.rebuildIndex', async () => {
      await indexer.build();
      vscode.window.showInformationMessage('MD Path Mentions: индекс пересобран');
    })
  );
}

export function deactivate() {}

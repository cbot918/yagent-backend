import type { Tool } from './types.js';
import { todoPost } from './eaiErp.js';

/**
 * eai-erp 待辦清單 + 成果清單的工具（module `todo`，走第三組 service token → AGENT_TODO）。
 *
 * 這組工具是「待辦工作流」的落地面（見 workflow/workflow-todolist.md）：
 *   1. list_todos       —— 有哪些待辦（只回標題，省 context）
 *   2. get_todo         —— 讀一筆的三層內文（raw / mid / good）
 *   3. refine_todo      —— 問答補完的細節寫回 mid / good，<b>永遠不動 raw</b>
 *   4. create_todo      —— 純記一筆（raw）
 *   5. set_todo_status  —— 開工／完成
 *   6. create_outcome   —— 任務產出收斂進成果清單
 *   7. list_outcomes    —— 之前產出過什麼
 *
 * 為什麼 refine 是獨立工具而不是「用 save 傳整包」：save 是整包覆寫，模型少帶一個欄位就會把
 * raw（使用者原始那段話）沖掉，而那正是最不該遺失的東西。專用端點讓它結構上碰不到 raw。
 */

interface Todo {
  id: string;
  title: string;
  raw: string;
  mid: string;
  good: string;
  maturity: 'RAW' | 'MID' | 'GOOD';
  status: string;
  priority: string;
  tag?: string | null;
  dueDate?: string | null;
  overdue?: boolean;
  doneAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface Outcome {
  id: string;
  title: string;
  kind: string;
  body: string;
  url?: string | null;
  todoId?: string | null;
  todoTitle?: string | null;
  tag?: string | null;
  createdAt?: string;
}

const MATURITY_LABEL: Record<string, string> = {
  RAW: '原始（只有重點，細節還沒補）',
  MID: '補充中（補了一部分，還不能派工）',
  GOOD: '已架構（可以直接派工）',
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: '未開始',
  DOING: '進行中',
  DONE: '已完成',
};

function todoLine(t: Todo, index: number): string {
  const bits = [
    STATUS_LABEL[t.status] ?? t.status,
    MATURITY_LABEL[t.maturity]?.split('（')[0] ?? t.maturity,
  ];
  if (t.priority && t.priority !== 'NORMAL') bits.push(`優先度 ${t.priority}`);
  if (t.tag) bits.push(`#${t.tag}`);
  if (t.dueDate) bits.push(t.overdue ? `⚠逾期 ${t.dueDate}` : `截止 ${t.dueDate}`);
  return `  ${index}. [${t.id}] ${t.title} | ${bits.join(' | ')}`;
}

export const listTodosTool: Tool = {
  name: 'list_todos',
  description:
    'List the todo items in eai-erp — id, title, status, and maturity (RAW / MID / GOOD). Returns TITLES ONLY, never the body text, so it is safe to call for "what do I have on my plate". Maturity is the key signal: RAW means the details were never filled in, GOOD means it is already architected and can be dispatched. Call this FIRST to get a real todo id before get_todo / refine_todo.',
  parameters: {
    type: 'object',
    properties: {
      includeDone: {
        type: 'boolean',
        description: 'Include completed items (default false — only unfinished ones).',
      },
      maturity: {
        type: 'string',
        enum: ['RAW', 'MID', 'GOOD'],
        description: 'Only items at this maturity. Use RAW to find what still needs filling in.',
      },
      keyword: { type: 'string', description: 'Match against title and all three body layers.' },
      tag: { type: 'string', description: 'Exact tag match.' },
    },
  },
  async run(args) {
    const { includeDone, maturity, keyword, tag } = (args ?? {}) as {
      includeDone?: boolean;
      maturity?: string;
      keyword?: string;
      tag?: string;
    };
    const res = await todoPost<Todo[]>('/api/todo/todos/query', {
      statuses: includeDone ? undefined : ['OPEN', 'DOING'],
      maturity,
      keyword,
      tag,
      titlesOnly: true,
    });
    if (!res.ok) return `Error: ${res.error}`;
    if (!res.data.length) return 'No todo items.';

    const lines = res.data.map((t, i) => todoLine(t, i + 1));
    return (
      `TODO ITEMS (${res.data.length}) — id | title | status | maturity:\n${lines.join('\n')}\n\n` +
      '成熟度：原始＝細節沒補、補充中＝補了一半、已架構＝可派工。' +
      '要看內文請用 get_todo（list 一律不回內文）。'
    );
  },
};

export const getTodoTool: Tool = {
  name: 'get_todo',
  description:
    'Read ONE todo item in full: all three body layers (raw = what the user originally dumped, mid = partially filled in, good = the finished task architecture). Read this before refining or acting on a todo — the raw layer is where the real intent is, and it usually leaves out details you must ask about rather than invent.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Todo id from list_todos.' },
    },
    required: ['id'],
  },
  async run(args) {
    const { id } = args as { id: string };
    const res = await todoPost<Todo>(
      `/api/todo/todos/detail?id=${encodeURIComponent(id)}`,
      {},
    );
    if (!res.ok) return `Error: ${res.error}`;
    if (!res.data) return `Error: todo "${id}" not found`;

    const t = res.data;
    const meta = [
      `status=${STATUS_LABEL[t.status] ?? t.status}`,
      `maturity=${t.maturity}（${MATURITY_LABEL[t.maturity] ?? '?'}）`,
      `priority=${t.priority}`,
      t.tag ? `tag=${t.tag}` : '',
      t.dueDate ? `due=${t.dueDate}${t.overdue ? ' ⚠逾期' : ''}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const layer = (label: string, body: string) =>
      body ? `\n--- ${label} ---\n${body}` : `\n--- ${label} ---\n（空）`;

    return (
      `TODO [${t.id}] ${t.title}\n  ${meta}` +
      layer('raw（原始重點，永不覆蓋）', t.raw) +
      layer('mid（補充中）', t.mid) +
      layer('good（完整任務架構，可派工）', t.good)
    );
  },
};

export const refineTodoTool: Tool = {
  name: 'refine_todo',
  description:
    'Write the results of filling in a todo back to eai-erp: the mid layer (partially filled in — use this when the discussion stopped short) and/or the good layer (the finished, dispatchable task architecture). NEVER touches the raw layer, by design. Omit a field to leave it unchanged; pass an empty string to clear it. Use this — not a full save — whenever you are recording what a Q&A session produced.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Todo id from list_todos.' },
      mid: {
        type: 'string',
        description:
          'Partially filled-in detail (markdown). Use when details are still missing — record what you DO know plus the open questions.',
      },
      good: {
        type: 'string',
        description:
          'The complete task architecture (markdown): goal, scope, steps, deliverable, acceptance criteria, known constraints. Only write this when it is genuinely dispatchable.',
      },
      title: { type: 'string', description: 'Optionally sharpen the title. Cannot be blank.' },
    },
    required: ['id'],
  },
  async run(args) {
    const { id, mid, good, title } = args as {
      id: string;
      mid?: string;
      good?: string;
      title?: string;
    };
    if (mid === undefined && good === undefined && title === undefined) {
      return 'Error: give at least one of mid / good / title.';
    }
    const res = await todoPost<Todo>('/api/todo/todos/refine', { id, mid, good, title });
    if (!res.ok) return `Error: ${res.error}`;
    const t = res.data;
    return (
      `已寫回 [${t.id}] ${t.title}\n` +
      `  成熟度 → ${t.maturity}（${MATURITY_LABEL[t.maturity] ?? '?'}）\n` +
      `  raw ${t.raw.length} 字（未動）/ mid ${t.mid.length} 字 / good ${t.good.length} 字`
    );
  },
};

export const createTodoTool: Tool = {
  name: 'create_todo',
  description:
    'Record a new todo item in eai-erp. The text goes into the raw layer — that is correct for "just note this down": raw means "the original dump, details not filled in yet". Do NOT try to flesh it out into a task architecture here unless the user actually worked through it with you.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title — what needs doing.' },
      raw: { type: 'string', description: 'The detail as given (markdown). May be empty.' },
      priority: { type: 'string', enum: ['HIGH', 'NORMAL', 'LOW'] },
      tag: { type: 'string', description: 'Free tag — client / context.' },
      dueDate: { type: 'string', description: 'Due date, yyyy-MM-dd.' },
    },
    required: ['title'],
  },
  async run(args) {
    const { title, raw, priority, tag, dueDate } = args as {
      title: string;
      raw?: string;
      priority?: string;
      tag?: string;
      dueDate?: string;
    };
    const res = await todoPost<Todo>('/api/todo/todos/create', {
      title,
      raw,
      priority,
      tag,
      dueDate,
    });
    if (!res.ok) return `Error: ${res.error}`;
    return `已新增待辦 [${res.data.id}] ${res.data.title}（成熟度 RAW，排在清單最前面）`;
  },
};

export const setTodoStatusTool: Tool = {
  name: 'set_todo_status',
  description:
    'Change a todo item status: OPEN (not started) / DOING (in progress) / DONE (finished). Set DOING when the task is actually dispatched, and DONE only after the deliverable exists — normally right after create_outcome.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Todo id from list_todos.' },
      status: { type: 'string', enum: ['OPEN', 'DOING', 'DONE'] },
    },
    required: ['id', 'status'],
  },
  async run(args) {
    const { id, status } = args as { id: string; status: string };
    const res = await todoPost<Todo>('/api/todo/todos/setStatus', { id, status });
    if (!res.ok) return `Error: ${res.error}`;
    return `[${res.data.id}] ${res.data.title} → ${STATUS_LABEL[res.data.status] ?? res.data.status}`;
  },
};

export const createOutcomeTool: Tool = {
  name: 'create_outcome',
  description:
    'Record a deliverable in the outcome list — this is where finished work converges. Link it to its source todo with todoId whenever there is one. kind: REPORT (the report body goes in `body`), LINK (url), FILE (url — no upload yet), NOTE (anything else).',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'What this deliverable is.' },
      kind: { type: 'string', enum: ['REPORT', 'LINK', 'FILE', 'NOTE'] },
      body: { type: 'string', description: 'Content / summary (markdown). Reports go here.' },
      url: { type: 'string', description: 'External link (LINK / FILE).' },
      todoId: { type: 'string', description: 'Source todo id — set it whenever one exists.' },
      tag: { type: 'string' },
    },
    required: ['title'],
  },
  async run(args) {
    const { title, kind, body, url, todoId, tag } = args as {
      title: string;
      kind?: string;
      body?: string;
      url?: string;
      todoId?: string;
      tag?: string;
    };
    const res = await todoPost<Outcome>('/api/todo/outcomes/create', {
      title,
      kind,
      body,
      url,
      todoId,
      tag,
    });
    if (!res.ok) return `Error: ${res.error}`;
    const o = res.data;
    const from = o.todoTitle ? `，來自待辦「${o.todoTitle}」` : '';
    return `已記錄成果 [${o.id}] ${o.title}（${o.kind}）${from}`;
  },
};

export const listOutcomesTool: Tool = {
  name: 'list_outcomes',
  description:
    'List recorded deliverables (outcome list), optionally narrowed to one source todo or one kind. Use it to check what was already produced before redoing work, and to answer "where is that report".',
  parameters: {
    type: 'object',
    properties: {
      todoId: { type: 'string', description: 'Only deliverables from this todo.' },
      kind: { type: 'string', enum: ['REPORT', 'LINK', 'FILE', 'NOTE'] },
      keyword: { type: 'string' },
    },
  },
  async run(args) {
    const { todoId, kind, keyword } = (args ?? {}) as {
      todoId?: string;
      kind?: string;
      keyword?: string;
    };
    const res = await todoPost<Outcome[]>('/api/todo/outcomes/query', { todoId, kind, keyword });
    if (!res.ok) return `Error: ${res.error}`;
    if (!res.data.length) return 'No outcomes recorded yet.';

    const lines = res.data.map((o) => {
      const from = o.todoTitle ? ` | 來自: ${o.todoTitle}` : '';
      const link = o.url ? ` | ${o.url}` : '';
      const size = o.body ? ` | 內文 ${o.body.length} 字` : '';
      return `  - [${o.id}] ${o.title} | ${o.kind}${from}${link}${size}`;
    });
    return `OUTCOMES (${res.data.length}):\n${lines.join('\n')}`;
  },
};

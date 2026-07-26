import type { Tool } from './types.js';
import { swpmPost } from './eaiErp.js';

/**
 * Read-only view of the eai-erp software-project module (swpm). These are the grounding
 * tools: the model must call them before writing, so it uses real project ids, real stage
 * numbers, and real assignee emails instead of inventing them.
 *
 * Output is compact text rather than raw JSON — the backend already computes the derived
 * signals (progress / health / overdue, with subtask inheritance applied), so the model
 * should read them, not recompute them.
 */

interface SwProjectOverview {
  id: string;
  name: string;
  description?: string | null;
  repoUrl?: string | null;
  status?: string;
  currentStage?: number;
  progress?: number;
  health?: string;
  overdueCount?: number;
  totalTasks?: number;
  latestActivity?: string | null;
  latestActivityAt?: string | null;
}

interface SwTask {
  id: string;
  projectId: string;
  stageNumber: number;
  parentTaskId?: string | null;
  name: string;
  assigneeEmail?: string | null;
  assigneeName?: string | null;
  dueDate?: string | null;
  status: string;
  blockedReason?: string | null;
  overdue?: boolean;
  assigneeInherited?: boolean;
  dueDateInherited?: boolean;
}

interface SwStage {
  stageNumber: number;
  stageName: string;
  state: string;
  note?: string | null;
}

interface SwActivity {
  type: string;
  content: string;
  createdAt: string;
}

interface SwUser {
  email: string;
  name: string;
}

interface SwProjectDetail {
  project: SwProjectOverview;
  stages: SwStage[];
  tasks: SwTask[];
  activities: SwActivity[];
  users: SwUser[];
  health?: string;
  progress?: number;
  overdueCount?: number;
}

interface SwTaskSearch {
  task: SwTask;
  projectName: string;
  stageName: string;
}

interface SwComment {
  id: string;
  taskId?: string | null;
  authorName: string;
  authorEmail: string;
  content: string;
  createdAt: string;
}

/** "2026-07-24T12:34:16.767875Z" → "2026-07-24"; passes plain dates through. */
function day(iso?: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

function taskLine(t: SwTask, prefix = '  '): string {
  const kind = t.parentTaskId ? '↳ ' : '';
  const assignee = t.assigneeName ?? t.assigneeEmail ?? '未指派';
  const inherited = t.assigneeInherited || t.dueDateInherited ? ' (繼承自主任務)' : '';
  const due = t.dueDate ? `due ${t.dueDate}` : 'no due';
  const flags = [t.overdue ? '⚠逾期' : '', t.blockedReason ? `卡關: ${t.blockedReason}` : '']
    .filter(Boolean)
    .join(' ');
  return `${prefix}${kind}[${t.id}] ${t.name} | ${t.status} | ${assignee} | ${due}${inherited}${flags ? ` | ${flags}` : ''}`;
}

export const listSwProjectsTool: Tool = {
  name: 'list_sw_projects',
  description:
    'List all software projects in eai-erp with their live health signals: stage, progress %, health (正常/高風險), overdue task count, total tasks, and the latest activity. Call this FIRST to find a project id before any other swpm tool. Use it to answer "what projects are there", "which ones are active", and "which are at risk".',
  parameters: {
    type: 'object',
    properties: {
      includeArchived: {
        type: 'boolean',
        description: 'Include archived projects (default false — only active ones).',
      },
    },
  },
  async run(args) {
    const { includeArchived } = (args ?? {}) as { includeArchived?: boolean };
    const res = await swpmPost<SwProjectOverview[]>('/api/swpm/projects/query', {});
    if (!res.ok) return `Error: ${res.error}`;

    const projects = includeArchived ? res.data : res.data.filter((p) => p.status !== 'ARCHIVED');
    if (!projects.length) return 'No software projects.';

    const lines = projects.map((p) => {
      const stage = `階段 ${p.currentStage ?? '?'}/3`;
      const overdue = p.overdueCount ? `逾期 ${p.overdueCount}` : '無逾期';
      const latest = p.latestActivity
        ? ` | 最新: ${p.latestActivity} (${day(p.latestActivityAt)})`
        : '';
      // repoUrl may hold either a git URL or a local absolute path. Surface it here (rather
      // than only in the project detail) because when it IS a path it is what the coding
      // harness must be pointed at; when it is not, the workspace map is the fallback.
      const repo = p.repoUrl ? `\n      repo: ${p.repoUrl}` : '';
      return (
        `  - [${p.id}] ${p.name} | ${p.status} | ${stage} | ${p.progress ?? 0}% | ` +
        `${p.health ?? '?'} | ${overdue} | ${p.totalTasks ?? 0} tasks${latest}${repo}`
      );
    });
    return `SOFTWARE PROJECTS (id | name | status | stage | progress | health | overdue | tasks | latest):\n${lines.join('\n')}`;
  },
};

export const getSwProjectTool: Tool = {
  name: 'get_sw_project',
  description:
    'Get one software project in full: its 3 stages (設計→開發→上線), every task with assignee/due/status/overdue flag, recent activity, and the list of accounts a task can be assigned to. Call this before creating or updating tasks — it gives you the real stage numbers, task ids, and assignable emails.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Project id from list_sw_projects.' },
    },
    required: ['id'],
  },
  async run(args) {
    const { id } = args as { id: string };
    const res = await swpmPost<SwProjectDetail>(
      `/api/swpm/projects/detail?id=${encodeURIComponent(id)}`,
      {},
    );
    if (!res.ok) return `Error: ${res.error}`;
    if (!res.data) return `Error: project "${id}" not found`;

    const d = res.data;
    const p = d.project;
    const header =
      `PROJECT [${p.id}] ${p.name}\n` +
      `  status=${p.status} stage=${p.currentStage}/3 progress=${d.progress ?? 0}% ` +
      `health=${d.health ?? '?'} overdue=${d.overdueCount ?? 0}\n` +
      (p.description ? `  description: ${p.description}\n` : '') +
      (p.repoUrl ? `  repo: ${p.repoUrl}\n` : '');

    const byStage = d.stages
      .map((s) => {
        const tasks = d.tasks.filter((t) => t.stageNumber === s.stageNumber);
        const body = tasks.length ? tasks.map((t) => taskLine(t, '    ')).join('\n') : '    (no tasks)';
        return `  階段 ${s.stageNumber} ${s.stageName} [${s.state}]\n${body}`;
      })
      .join('\n');

    const recent = d.activities.slice(0, 5).map((a) => `  - ${day(a.createdAt)} ${a.content}`);
    const users = d.users.map((u) => `  - ${u.email} (${u.name})`);

    return (
      `${header}\nTASKS BY STAGE (taskId | name | status | assignee | due):\n${byStage}\n\n` +
      `RECENT ACTIVITY:\n${recent.length ? recent.join('\n') : '  (none)'}\n\n` +
      `ASSIGNABLE ACCOUNTS (use the email as assigneeEmail):\n${users.join('\n')}`
    );
  },
};

export const listSwCommentsTool: Tool = {
  name: 'list_sw_comments',
  description:
    'Read the comment thread of a software project, optionally narrowed to one task. This is how a hand-off is received: whoever finished the previous step leaves their result as a comment (e.g. QA posts the key functions to accept), and the next role reads it here instead of being told second-hand.',
  parameters: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Project id from list_sw_projects.' },
      taskId: { type: 'string', description: 'Only comments attached to this task.' },
    },
    required: ['projectId'],
  },
  async run(args) {
    const { projectId, taskId } = args as { projectId: string; taskId?: string };
    const res = await swpmPost<SwComment[]>(
      `/api/swpm/comments/query?projectId=${encodeURIComponent(projectId)}`,
      {},
    );
    if (!res.ok) return `Error: ${res.error}`;

    const comments = taskId ? res.data.filter((c) => c.taskId === taskId) : res.data;
    if (!comments.length) return taskId ? `No comments on task ${taskId}.` : 'No comments on this project.';

    const lines = comments.map(
      (c) =>
        `  - ${day(c.createdAt)} ${c.authorName} (${c.authorEmail})` +
        `${c.taskId ? ` [task ${c.taskId}]` : ''}\n    ${c.content.replace(/\n/g, '\n    ')}`,
    );
    return `COMMENTS:\n${lines.join('\n')}`;
  },
};

export const querySwTasksTool: Tool = {
  name: 'query_sw_tasks',
  description:
    'Search tasks ACROSS all software projects, sorted most-urgent-first (overdue first, then earliest due date). Use this to answer "what is urgent right now", "what is on engineer\'s plate", or "what is blocked" without opening each project. Subtasks that inherit their parent\'s assignee/due date are matched on the inherited value, so nothing hides. By default only unfinished tasks (TODO/IN_PROGRESS/BLOCKED) are returned.',
  parameters: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Limit to one project; omit to search all.' },
      assigneeEmail: {
        type: 'string',
        description: 'Filter by assignee account email, e.g. engineer@agent.local.',
      },
      statuses: {
        type: 'array',
        items: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'] },
        description: 'Omit for all unfinished tasks; pass ["DONE"] to see completed ones.',
      },
      overdueOnly: { type: 'boolean', description: 'Only tasks already past their due date.' },
      dueBefore: {
        type: 'string',
        description: 'Only tasks due on or before this date ("yyyy-MM-dd"). Tasks with no due date never match.',
      },
      includeArchived: { type: 'boolean', description: 'Include tasks of archived projects (default false).' },
      limit: { type: 'number', description: 'Max rows (default 100, max 500).' },
    },
  },
  async run(args) {
    const res = await swpmPost<SwTaskSearch[]>('/api/swpm/tasks/query', args ?? {});
    if (!res.ok) return `Error: ${res.error}`;
    if (!res.data.length) return 'No matching tasks.';

    const lines = res.data.map(
      (r) => `${taskLine(r.task)} | ${r.projectName} / ${r.stageName}`,
    );
    return `TASKS, most urgent first (taskId | name | status | assignee | due | project / stage):\n${lines.join('\n')}`;
  },
};

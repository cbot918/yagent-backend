import type { Tool } from './types.js';
import { swpmPost } from './eaiErp.js';

/**
 * Mutating tools for the eai-erp software-project module (swpm). Kept in their own file
 * because that split is also the `advise` boundary: only the read tools in `swpmRead.ts`
 * belong in `READONLY_TOOLS`, so an advising role can inspect projects but never change them.
 *
 * These stay thin — the backend owns validation (BLOCKED needs a reason, dates are parsed
 * server-side) and writes the project activity trail as a side effect of a status change.
 */

interface SwTask {
  id: string;
  projectId: string;
  stageNumber: number;
  name: string;
  assigneeEmail?: string | null;
  assigneeName?: string | null;
  dueDate?: string | null;
  status: string;
  blockedReason?: string | null;
  overdue?: boolean;
}

interface SwComment {
  id: string;
  taskId?: string | null;
  authorName: string;
  content: string;
}

function describe(t: SwTask): string {
  const assignee = t.assigneeName ?? t.assigneeEmail ?? '未指派';
  const due = t.dueDate ? `due ${t.dueDate}` : 'no due date';
  const blocked = t.blockedReason ? ` | 卡關: ${t.blockedReason}` : '';
  return `[${t.id}] ${t.name} | stage ${t.stageNumber} | ${t.status} | ${assignee} | ${due}${blocked}`;
}

export const createSwTaskTool: Tool = {
  name: 'create_sw_task',
  description:
    'Add a task to a software project. Call get_sw_project first so the stageNumber, parentTaskId and assigneeEmail are real values. Stages are 1=設計 2=開發 3=上線. Pass parentTaskId to make this a subtask — a subtask with no assignee or due date of its own inherits the parent\'s, which is the normal way to split one feature across roles.',
  parameters: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Project id from list_sw_projects.' },
      stageNumber: { type: 'number', description: '1 = 設計, 2 = 開發, 3 = 上線.' },
      name: { type: 'string', description: 'Task name, in the language the user used.' },
      parentTaskId: { type: 'string', description: 'Make this a subtask of that task.' },
      assigneeEmail: {
        type: 'string',
        description: 'Account email to assign to, e.g. engineer@agent.local. Omit to leave unassigned (or to inherit, for a subtask).',
      },
      dueDate: { type: 'string', description: 'Due date "yyyy-MM-dd".' },
    },
    required: ['projectId', 'stageNumber', 'name'],
  },
  async run(args) {
    const res = await swpmPost<SwTask>('/api/swpm/tasks/add', args);
    if (!res.ok) return `Error: ${res.error}`;
    return `Task created: ${describe(res.data)}`;
  },
};

export const updateSwTaskTool: Tool = {
  name: 'update_sw_task',
  description:
    'Update an existing task: rename, reassign, change the due date, or move its status through TODO → IN_PROGRESS → BLOCKED → DONE. Only the fields you pass change. Setting status to BLOCKED REQUIRES blockedReason — the backend rejects it otherwise. Every status change is written to the project activity trail automatically, so use this to record progress rather than only reporting it in chat.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Task id (from get_sw_project or query_sw_tasks).' },
      name: { type: 'string' },
      assigneeEmail: { type: 'string', description: 'Account email; e.g. qa@agent.local.' },
      dueDate: { type: 'string', description: 'Due date "yyyy-MM-dd".' },
      status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'] },
      blockedReason: { type: 'string', description: 'Required when status is BLOCKED; say what is actually waiting.' },
    },
    required: ['id'],
  },
  async run(args) {
    const { id, ...patch } = args as { id: string } & Record<string, unknown>;
    const res = await swpmPost<SwTask>(`/api/swpm/tasks/edit?id=${encodeURIComponent(id)}`, patch);
    if (!res.ok) return `Error: ${res.error}`;
    return `Task updated: ${describe(res.data)}`;
  },
};

export const addSwCommentTool: Tool = {
  name: 'add_sw_comment',
  description:
    'Post a comment on a software project, optionally attached to one task. Use this to leave a hand-off for the next role (e.g. QA posting the key functions SA should accept) or to record a decision. The comment is authored by this agent account and shows up in the project UI, so it is the durable record — prefer it over passing findings only through chat.',
  parameters: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Project id from list_sw_projects.' },
      taskId: { type: 'string', description: 'Attach the comment to this task.' },
      content: { type: 'string', description: 'Comment body. Markdown and line breaks are fine.' },
    },
    required: ['projectId', 'content'],
  },
  async run(args, ctx) {
    const { content, ...rest } = args as { content: string } & Record<string, unknown>;
    // Every agent authenticates as the same ERP service account, so the stored author is
    // always "AI SWPM Agent" — a hand-off thread would be unreadable without knowing which
    // role wrote which entry. Stamp the role into the body, which is the only field we own.
    const signed = ctx.roleId ? `**[${ctx.roleId}]**\n\n${content}` : content;

    const res = await swpmPost<SwComment>('/api/swpm/comments/add', { ...rest, content: signed });
    if (!res.ok) return `Error: ${res.error}`;
    const c = res.data;
    return `Comment posted as ${ctx.roleId ?? c.authorName}${c.taskId ? ` on task ${c.taskId}` : ''} (id ${c.id}).`;
  },
};

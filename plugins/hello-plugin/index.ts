// Example code plugin — demonstrates the Plugin extension point.
// Plugins register tools (or channels) via init(ctx).
// Skills, by contrast, are markdown SKILL.md files (prompt-based).

const helloPlugin = {
  name: 'hello-plugin',

  init(ctx: { registerTool(tool: unknown): void }) {
    ctx.registerTool({
      name: 'hello',
      description: 'Demo plugin tool — greet someone by name (added by hello-plugin)',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name to greet' },
        },
        required: ['name'],
      },
      async run(args: { name: string }) {
        return `Hello, ${args.name}! 👋 (from hello-plugin)`;
      },
    });
  },
};

export default helloPlugin;

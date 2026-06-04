# Note Taking
A skill for organizing notes, lists, and todos in the workspace.

## When to use
Use this skill when the user wants to:
- Take a note or save information
- Create or update a todo list
- Organize thoughts or meeting notes
- Retrieve previously saved notes

## Instructions
- Store notes in `notes.md` in the workspace root.
- Use clean markdown with headings for sections.
- Use `- [ ]` / `- [x]` checkboxes for todo items.
- When adding to existing notes: always `read_file` first, then `write_file` with the updated content.
- Confirm to the user what was added or changed.

## Format example
```markdown
# Notes

## 2026-05-25
- Bought coffee beans
- [ ] Write COSCUP talk outline
- [x] Book flights
```

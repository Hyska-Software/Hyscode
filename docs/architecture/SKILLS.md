# Skills Architecture

## Overview

Skills are reusable, composable instruction sets (written in Markdown) that modify the agent's behavior, knowledge, and capabilities. They function similarly to Claude Code's skill system — injected into the system prompt to give the agent domain-specific expertise.

---

## Skill Format

Each skill is a Markdown file with YAML frontmatter:

```markdown
---
name: code-review
description: Perform thorough code reviews following best practices
trigger: when user asks to review code, check PR, or audit quality
scope: builtin
allowed-tools:
  - read_file
  - search_code
  - git_diff
tags:
  - review
  - quality
---

# Code Review Skill

## Instructions

When reviewing code, follow these steps:

1. **Read the diff**: Use `git_diff` to understand what changed
2. **Check for bugs**: Look for null pointer issues, race conditions, off-by-one errors
3. **Security**: Check for injection vulnerabilities, hardcoded secrets, unsafe deserialization
4. **Performance**: Identify N+1 queries, unnecessary allocations, missing indexes
5. **Style**: Verify naming conventions, function length, code organization

## Output Format

Provide feedback as:
- **P0 (Critical)**: Must fix before merge — bugs, security issues
- **P1 (Important)**: Should fix — performance, maintainability
- **P2 (Suggestion)**: Nice to have — style, minor improvements

## Anti-Patterns to Flag
- Functions longer than 50 lines
- Deeply nested conditionals (>3 levels)
- Hardcoded magic numbers
- Missing error handling at system boundaries
- Unused imports or dead code
```

---

## Frontmatter Schema

```typescript
interface SkillFrontmatter {
  name: string;                           // unique identifier
  description: string;                    // short description for UI/agent
  trigger?: string;                       // natural language trigger condition
  scope?: 'builtin' | 'global' | 'workspace';
  'allowed-tools'?: string[];             // tools this skill can use
  tags?: string[];                        // for categorization/search
  'user-invocable'?: boolean;             // can user manually activate (default: true)
  priority?: number;                      // injection order (higher = later in prompt)
}
```

---

## Skill Scopes & Resolution

### Scope Hierarchy

```
1. Built-in:    packages/skills/           (shipped with app)
2. Global:      ~/.hyscode/skills/         (user's global skills)
3. Workspace:   .hyscode/skills/           (project-specific skills)
```

**Resolution**: workspace overrides global, global overrides built-in (matched by `name`).

### Skill Discovery

```typescript
async function discoverSkills(workspacePath: string): Promise<Skill[]> {
  const dirs = [
    BUILT_IN_SKILLS_DIR,                  // packages/skills/
    GLOBAL_SKILLS_DIR,                    // ~/.hyscode/skills/
    join(workspacePath, '.hyscode/skills') // workspace
  ];

  const skills: Map<string, Skill> = new Map();

  for (const dir of dirs) {
    const files = await glob(join(dir, '**/*.md'));
    for (const file of files) {
      const skill = await parseSkill(file);
      skills.set(skill.name, skill);      // later scopes override earlier
    }
  }

  return Array.from(skills.values());
}
```

---

## Skill Activation

### Activation Modes

1. **Always active**: skills without a `trigger` field are always included in system prompt
2. **Trigger-based**: skills with a `trigger` field are activated when the condition matches
3. **Manual**: user explicitly enables/disables from the Skills panel
4. **Agent-requested**: agent calls `activate_skill(name)` meta-tool

### Trigger Matching

```typescript
async function matchSkillTriggers(
  userMessage: string,
  activeSkills: Skill[],
  allSkills: Skill[]
): Promise<Skill[]> {
  const triggered: Skill[] = [];

  for (const skill of allSkills) {
    if (activeSkills.includes(skill)) continue;          // already active
    if (!skill.trigger) continue;                        // always-active (handled elsewhere)

    // Simple keyword/phrase matching
    // Future: LLM-based trigger evaluation for complex conditions
    if (matchesTrigger(userMessage, skill.trigger)) {
      triggered.push(skill);
    }
  }

  return triggered;
}
```

---

## System Prompt Injection

Active skills are injected into the system prompt:

```typescript
function buildSystemPrompt(basePrompt: string, activeSkills: Skill[]): string {
  if (activeSkills.length === 0) return basePrompt;

  const skillsBlock = activeSkills
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    .map(skill => `<skill name="${skill.name}">\n${skill.content}\n</skill>`)
    .join('\n\n');

  return `${basePrompt}\n\n<skills>\n${skillsBlock}\n</skills>`;
}
```

---

## Built-in Skills

### Core Skills (always active)

| Skill | Description |
|---|---|
| `base-agent` | Core agent instructions: how to use tools, format responses, handle errors |
| `code-editing` | Best practices for editing code: small changes, preserve style, test after edit |

### Domain Skills (trigger-based)

| Skill | Trigger | Description |
|---|---|---|
| `code-review` | "review", "check code", "audit" | Thorough code review with severity levels |
| `refactor` | "refactor", "clean up", "improve" | Safe refactoring patterns with test verification |
| `test-generation` | "write tests", "add tests", "test" | Test writing with coverage strategies |
| `doc-writing` | "document", "docstring", "readme" | Documentation generation |
| `security-audit` | "security", "vulnerability", "OWASP" | Security-focused code review |
| `debug` | "debug", "fix bug", "error" | Systematic debugging methodology |
| `performance` | "optimize", "slow", "performance" | Performance analysis and optimization |
| `git-workflow` | "commit", "branch", "merge" | Git best practices and conventional commits |

---

## Skills UI

### Skills Panel (Sidebar)

```
Skills                                [+ New Skill]
┌──────────────────────────────────────────────────┐
│  Active Skills                                    │
│  ■ base-agent (always)                   builtin  │
│  ■ code-editing (always)                 builtin  │
│  ■ code-review (triggered)               builtin  │
│                                                   │
│  Available Skills                                 │
│  □ refactor                              builtin  │
│  □ test-generation                       builtin  │
│  □ doc-writing                           builtin  │
│  □ security-audit                        builtin  │
│  □ debug                                 builtin  │
│  ■ my-team-standards                     workspace │
│                                                   │
│  [Open Skills Directory]                          │
└──────────────────────────────────────────────────┘
```

### Skill Editor

Users can create and edit skills directly in the Monaco Editor:
- Skills panel shows "New Skill" button → creates template `.md` file
- Syntax highlighting for YAML frontmatter
- Preview of how skill will appear in system prompt
- Validation: checks for required frontmatter fields

---

## Skill Composition

Multiple skills can be active simultaneously. The system handles:

1. **Token budget**: skills consume system prompt tokens; if budget exceeded, lower-priority skills are deactivated with a warning
2. **Tool conflicts**: if two skills declare different `allowed-tools`, the union is used
3. **Instruction conflicts**: later skills (higher priority) take precedence for conflicting instructions
4. **Context awareness**: skills can reference each other (e.g., `debug` skill can activate `test-generation`)

---

## Custom Skill Example

A user creates `.hyscode/skills/django-patterns.md` in their project:

```markdown
---
name: django-patterns
description: Django project conventions for our team
trigger: when working with Python/Django files
tags:
  - python
  - django
---

# Django Patterns

## Models
- Always use `UUIDField` as primary key
- Add `created_at` and `updated_at` timestamps to all models
- Use `TextChoices` for enum fields

## Views
- Use class-based views for CRUD
- Use function views for custom logic
- Always use `get_object_or_404`

## Serializers
- Use `ModelSerializer` with explicit `fields` (never `__all__`)
- Validate at serializer level, not view level

## Tests
- Use `pytest-django` with `@pytest.mark.django_db`
- Factory Boy for test data
- Test edge cases: empty, null, boundary values
```

This skill is automatically detected when the project contains `.hyscode/skills/` and activated when the agent works with Python/Django files in that workspace.

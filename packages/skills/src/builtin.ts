// ─── Built-in Skills ────────────────────────────────────────────────────────
// Skill content templates shipped with the app.

export const BUILTIN_SKILLS: Record<string, string> = {
  'code-style': `---
name: code-style
description: Enforces consistent code style and conventions for the project.
version: 1.0.0
scope: built-in
activation: always
---

# Code Style Guide

## General Principles
- Follow the existing codebase conventions before introducing new patterns
- Use TypeScript strict mode — no \`any\` types unless absolutely necessary
- Prefer \`const\` over \`let\`, never use \`var\`
- Use meaningful, descriptive variable and function names
- Keep functions small and focused (single responsibility)

## Naming Conventions
- **Files**: kebab-case for all files (\`user-service.ts\`, \`auth-middleware.ts\`)
- **Classes**: PascalCase (\`UserService\`, \`AuthMiddleware\`)
- **Functions/Methods**: camelCase (\`getUserById\`, \`validateInput\`)
- **Constants**: UPPER_SNAKE_CASE for true constants (\`MAX_RETRIES\`, \`API_BASE_URL\`)
- **Interfaces/Types**: PascalCase, no \`I\` prefix (\`UserData\`, not \`IUserData\`)
- **Enums**: PascalCase for name and values

## Import Order
1. External packages (node_modules)
2. Internal packages (workspace packages)
3. Relative imports (local files)
4. Type-only imports last

## Error Handling
- Always handle errors explicitly, never silently catch
- Use typed errors when possible
- Log errors with sufficient context for debugging
- Return meaningful error messages to the user
`,

  'testing': `---
name: testing
description: Best practices for writing tests.
version: 1.0.0
scope: built-in
activation: trigger
trigger: when user mentions testing, tests, test coverage, unit test, integration test
agents:
  - test
  - build
---

# Testing Best Practices

## Test Structure
- Use \`describe\` blocks to group related tests
- Use clear, behavior-describing test names: "should return 404 when user not found"
- Follow Arrange-Act-Assert (AAA) pattern
- One assertion per test when possible

## What to Test
- **Happy path**: normal expected behavior
- **Edge cases**: empty inputs, nulls, boundary values, large inputs
- **Error cases**: invalid inputs, network failures, permissions
- **Integration points**: API calls, database queries, external services

## Mocking Guidelines
- Mock external dependencies, not the code under test
- Use dependency injection to make code testable
- Reset mocks between tests
- Prefer manual mocks over auto-mocking for complex dependencies

## Coverage Goals
- Aim for 80%+ coverage on business logic
- 100% coverage on utility functions and pure functions
- Don't chase coverage numbers — focus on meaningful tests
`,

  'security': `---
name: security
description: Security best practices and vulnerability prevention.
version: 1.0.0
scope: built-in
activation: always
agents:
  - build
  - review
---

# Security Guidelines

## Input Validation
- Validate all user inputs at system boundaries
- Use allowlists over denylists
- Sanitize data before rendering in HTML (prevent XSS)
- Parameterize all database queries (prevent SQL injection)

## Authentication & Authorization
- Never store passwords in plain text
- Use bcrypt/argon2 for password hashing
- Implement proper session management
- Check authorization on every request, not just client-side

## Secrets Management
- Never commit secrets to version control
- Use environment variables or secret managers
- Rotate API keys and credentials regularly
- Use least-privilege access for service accounts

## Common Vulnerabilities (OWASP Top 10)
- **Injection**: Parameterize queries, validate/sanitize inputs
- **Broken Auth**: Implement MFA, secure session handling
- **Sensitive Data Exposure**: Encrypt data at rest and in transit
- **XSS**: Sanitize output, use Content Security Policy
- **CSRF**: Use anti-CSRF tokens
- **Insecure Dependencies**: Keep dependencies updated, audit regularly
`,

  'git-workflow': `---
name: git-workflow
description: Git commit conventions and workflow best practices.
version: 1.0.0
scope: built-in
activation: trigger
trigger: when user mentions commit, git, version control, branch
---

# Git Workflow

## Conventional Commits
Format: \`type(scope): description\`

Types:
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style (formatting, no logic change)
- **refactor**: Code restructuring (no feature/fix)
- **test**: Adding or updating tests
- **chore**: Maintenance tasks

Examples:
- \`feat(auth): add OAuth2 login with Google\`
- \`fix(api): handle null response from payment gateway\`
- \`refactor(db): extract query builder from repository\`

## Branch Strategy
- \`main\`: production-ready code
- \`develop\`: integration branch
- \`feature/*\`: new features
- \`fix/*\`: bug fixes
- \`release/*\`: release preparation

## Commit Guidelines
- Make small, focused commits
- Each commit should compile and pass tests
- Write descriptive commit messages
- Reference issue numbers when applicable
`,

  'performance': `---
name: performance
description: Performance optimization guidelines.
version: 1.0.0
scope: built-in
activation: trigger
trigger: when user mentions performance, slow, optimize, speed, latency
agents:
  - build
  - refactor
---

# Performance Guidelines

## General Principles
- Measure before optimizing — don't guess bottlenecks
- Optimize the critical path first
- Consider time complexity (Big O) for data structure choices
- Cache expensive computations

## Frontend Performance
- Minimize bundle size (tree shaking, code splitting)
- Lazy load non-critical components
- Use \`React.memo\`, \`useMemo\`, \`useCallback\` for expensive renders
- Debounce user input handlers
- Use virtual scrolling for long lists

## Backend Performance
- Use database indexes on frequently queried columns
- Implement pagination for list endpoints
- Use connection pooling for database connections
- Cache frequently accessed data (with invalidation strategy)
- Use async/streaming for long-running operations

## Common Anti-Patterns
- N+1 query problems
- Unnecessary re-renders in React
- Synchronous I/O in hot paths
- Loading entire datasets when only a subset is needed
- Missing database indexes
`,

  'documentation': `---
name: documentation
description: Documentation writing standards.
version: 1.0.0
scope: built-in
activation: trigger
trigger: when user mentions docs, documentation, readme, comments, jsdoc
---

# Documentation Standards

## Code Comments
- Comment the **why**, not the **what**
- Use JSDoc/TSDoc for public APIs
- Keep comments up to date with code changes
- Remove commented-out code — use version control instead

## README Structure
1. Project name and brief description
2. Quick start / Getting started
3. Installation instructions
4. Usage examples
5. Configuration options
6. API reference (or link to docs)
7. Contributing guidelines
8. License

## API Documentation
- Document all public functions, classes, and types
- Include parameter descriptions and return types
- Provide usage examples
- Document error cases and edge cases
- Keep examples runnable and tested
`,
};

export function getBuiltinSkillNames(): string[] {
  return Object.keys(BUILTIN_SKILLS);
}

export function getBuiltinSkillContent(name: string): string | undefined {
  return BUILTIN_SKILLS[name];
}

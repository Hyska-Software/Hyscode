// Java Support Extension — main.js
// Provides runtime commands for Java, Maven and Gradle development

const JAVA_PROJECT_TYPES = [
  { label: 'Console App (plain Java)', value: 'console' },
  { label: 'Maven Project', value: 'maven' },
  { label: 'Gradle Project', value: 'gradle' },
  { label: 'Gradle Project (Kotlin DSL)', value: 'gradle-kts' },
];

const SPRING_DEPENDENCIES = [
  { label: 'Spring Web', value: 'web' },
  { label: 'Spring Data JPA', value: 'data-jpa' },
  { label: 'Spring Security', value: 'security' },
  { label: 'Spring Boot Actuator', value: 'actuator' },
  { label: 'Spring Boot DevTools', value: 'devtools' },
  { label: 'Lombok', value: 'lombok' },
  { label: 'PostgreSQL Driver', value: 'postgresql' },
  { label: 'MySQL Driver', value: 'mysql' },
  { label: 'H2 Database', value: 'h2' },
  { label: 'Thymeleaf', value: 'thymeleaf' },
  { label: 'Validation', value: 'validation' },
  { label: 'Spring WebSocket', value: 'websocket' },
];

export function activate(context) {
  console.log('[java-support] Extension activated');

  const api = context._api || globalThis.hyscode;
  if (!api) {
    console.warn('[java-support] HysCode API not available');
    return;
  }

  if (!api.commands) return;

  // ── Helpers ─────────────────────────────────────────────────────────────────
  async function runTerminal(cmd) {
    if (api.terminal && api.terminal.sendToActive) {
      await api.terminal.sendToActive(cmd);
    }
  }

  function detectBuildTool() {
    // Could be enhanced with workspace file detection
    return 'maven'; // default fallback
  }

  // ── New Java Project ────────────────────────────────────────────────────────
  api.commands.register('java.newProject', async () => {
    const type = await api.window?.showQuickPick?.(
      JAVA_PROJECT_TYPES,
      { placeHolder: 'Select project type' }
    );
    if (!type) return;

    const groupId = await api.window?.showInputBox?.({
      prompt: 'Group ID',
      placeHolder: 'com.example',
    });
    if (!groupId) return;

    const artifactId = await api.window?.showInputBox?.({
      prompt: 'Artifact ID (project name)',
      placeHolder: 'my-app',
    });
    if (!artifactId) return;

    if (type.value === 'maven') {
      await runTerminal(
        `mvn archetype:generate -DgroupId=${groupId} -DartifactId=${artifactId} -DarchetypeArtifactId=maven-archetype-quickstart -DarchetypeVersion=1.5 -DinteractiveMode=false`
      );
    } else if (type.value === 'gradle') {
      await runTerminal(`mkdir ${artifactId} && cd ${artifactId} && gradle init --type java-application --dsl groovy`);
    } else if (type.value === 'gradle-kts') {
      await runTerminal(`mkdir ${artifactId} && cd ${artifactId} && gradle init --type java-application --dsl kotlin`);
    } else {
      // Plain console project
      const pkg = groupId.replace(/\./g, '/');
      const dir = artifactId;
      const content = `package ${groupId};

public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
`;
      if (api.workspace && api.workspace.createFile) {
        await api.workspace.createFile(`${dir}/src/${pkg}/Main.java`, content);
      }
    }
  });

  // ── New Spring Boot Project ─────────────────────────────────────────────────
  api.commands.register('java.newSpringProject', async () => {
    const groupId = await api.window?.showInputBox?.({
      prompt: 'Group ID',
      placeHolder: 'com.example',
    });
    if (!groupId) return;

    const artifactId = await api.window?.showInputBox?.({
      prompt: 'Artifact ID',
      placeHolder: 'demo',
    });
    if (!artifactId) return;

    const deps = await api.window?.showQuickPick?.(
      SPRING_DEPENDENCIES,
      { placeHolder: 'Select dependencies (press Enter to confirm)', canPickMany: true }
    );

    const depList = deps && deps.length > 0
      ? deps.map(d => d.value).join(',')
      : 'web';

    // Uses Spring Initializr CLI via curl
    await runTerminal(
      `curl -s "https://start.spring.io/starter.zip?type=maven-project&language=java&bootVersion=3.4.0&groupId=${groupId}&artifactId=${artifactId}&dependencies=${depList}" -o ${artifactId}.zip && unzip ${artifactId}.zip -d ${artifactId} && rm ${artifactId}.zip`
    );
  });

  // ── New Java Class ──────────────────────────────────────────────────────────
  api.commands.register('java.newClass', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Class name',
      placeHolder: 'MyClass',
    });
    if (!name) return;

    const pkg = await api.window?.showInputBox?.({
      prompt: 'Package',
      placeHolder: 'com.example',
    });

    const content = `package ${pkg || 'com.example'};

public class ${name} {

    public ${name}() {
    }
}
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`${name}.java`, content);
    }
  });

  // ── New Java Interface ──────────────────────────────────────────────────────
  api.commands.register('java.newInterface', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Interface name',
      placeHolder: 'MyService',
    });
    if (!name) return;

    const pkg = await api.window?.showInputBox?.({
      prompt: 'Package',
      placeHolder: 'com.example',
    });

    const content = `package ${pkg || 'com.example'};

public interface ${name} {
}
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`${name}.java`, content);
    }
  });

  // ── New Java Enum ───────────────────────────────────────────────────────────
  api.commands.register('java.newEnum', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Enum name',
      placeHolder: 'Status',
    });
    if (!name) return;

    const pkg = await api.window?.showInputBox?.({
      prompt: 'Package',
      placeHolder: 'com.example',
    });

    const content = `package ${pkg || 'com.example'};

public enum ${name} {
    ACTIVE,
    INACTIVE;
}
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`${name}.java`, content);
    }
  });

  // ── New Java Record ─────────────────────────────────────────────────────────
  api.commands.register('java.newRecord', async () => {
    const name = await api.window?.showInputBox?.({
      prompt: 'Record name',
      placeHolder: 'Person',
    });
    if (!name) return;

    const pkg = await api.window?.showInputBox?.({
      prompt: 'Package',
      placeHolder: 'com.example',
    });

    const content = `package ${pkg || 'com.example'};

public record ${name}(String id) {
}
`;
    if (api.workspace && api.workspace.createFile) {
      await api.workspace.createFile(`${name}.java`, content);
    }
  });

  // ── Compile (javac) ─────────────────────────────────────────────────────────
  api.commands.register('java.compile', async () => {
    console.log('[java-support] Compile');
    const file = api.editor?.getActiveFilePath?.();
    if (file && file.endsWith('.java')) {
      await runTerminal(`javac "${file}"`);
    } else {
      await runTerminal('javac *.java');
    }
  });

  // ── Run Main Class ──────────────────────────────────────────────────────────
  api.commands.register('java.run', async () => {
    console.log('[java-support] Run');
    const file = api.editor?.getActiveFilePath?.();
    if (file && file.endsWith('.java')) {
      // Java 11+ can run .java files directly
      await runTerminal(`java "${file}"`);
    } else {
      const className = await api.window?.showInputBox?.({
        prompt: 'Main class (fully qualified)',
        placeHolder: 'com.example.Main',
      });
      if (className) {
        await runTerminal(`java ${className}`);
      }
    }
  });

  // ── Run Tests ───────────────────────────────────────────────────────────────
  api.commands.register('java.test', async () => {
    console.log('[java-support] Test');
    // Detect build tool and run appropriate test command
    await runTerminal('mvn test');
  });

  // ── Build JAR ───────────────────────────────────────────────────────────────
  api.commands.register('java.buildJar', async () => {
    console.log('[java-support] Build JAR');
    await runTerminal('mvn package -DskipTests');
  });

  // ── Maven Commands ──────────────────────────────────────────────────────────
  api.commands.register('maven.compile', async () => {
    await runTerminal('mvn compile');
  });

  api.commands.register('maven.package', async () => {
    await runTerminal('mvn package');
  });

  api.commands.register('maven.install', async () => {
    await runTerminal('mvn install');
  });

  api.commands.register('maven.clean', async () => {
    await runTerminal('mvn clean');
  });

  api.commands.register('maven.test', async () => {
    await runTerminal('mvn test');
  });

  api.commands.register('maven.addDependency', async () => {
    const groupId = await api.window?.showInputBox?.({
      prompt: 'Group ID',
      placeHolder: 'com.google.guava',
    });
    if (!groupId) return;

    const artifactId = await api.window?.showInputBox?.({
      prompt: 'Artifact ID',
      placeHolder: 'guava',
    });
    if (!artifactId) return;

    const version = await api.window?.showInputBox?.({
      prompt: 'Version',
      placeHolder: '33.0.0-jre',
    });
    if (!version) return;

    const snippet = `\n    <dependency>\n      <groupId>${groupId}</groupId>\n      <artifactId>${artifactId}</artifactId>\n      <version>${version}</version>\n    </dependency>`;

    api.window?.showInformationMessage?.(
      `Add to pom.xml <dependencies>:\n${snippet}`
    );
    console.log(`[java-support] Maven dependency snippet: ${snippet}`);
  });

  api.commands.register('maven.dependencyTree', async () => {
    await runTerminal('mvn dependency:tree');
  });

  api.commands.register('maven.effectivePom', async () => {
    await runTerminal('mvn help:effective-pom');
  });

  // ── Gradle Commands ─────────────────────────────────────────────────────────
  api.commands.register('gradle.build', async () => {
    await runTerminal('gradle build');
  });

  api.commands.register('gradle.clean', async () => {
    await runTerminal('gradle clean');
  });

  api.commands.register('gradle.test', async () => {
    await runTerminal('gradle test');
  });

  api.commands.register('gradle.run', async () => {
    await runTerminal('gradle run');
  });

  api.commands.register('gradle.tasks', async () => {
    await runTerminal('gradle tasks');
  });

  api.commands.register('gradle.dependencies', async () => {
    await runTerminal('gradle dependencies');
  });

  // ── Code Generation ─────────────────────────────────────────────────────────
  api.commands.register('java.generateGetterSetter', async () => {
    const fieldName = await api.window?.showInputBox?.({
      prompt: 'Field name',
      placeHolder: 'name',
    });
    if (!fieldName) return;

    const fieldType = await api.window?.showInputBox?.({
      prompt: 'Field type',
      placeHolder: 'String',
    });
    if (!fieldType) return;

    const capitalized = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
    const code = `
    public ${fieldType} get${capitalized}() {
        return this.${fieldName};
    }

    public void set${capitalized}(${fieldType} ${fieldName}) {
        this.${fieldName} = ${fieldName};
    }`;

    if (api.editor && api.editor.insertAtCursor) {
      api.editor.insertAtCursor(code);
    }
  });

  api.commands.register('java.generateConstructor', async () => {
    const fields = await api.window?.showInputBox?.({
      prompt: 'Fields (comma separated, e.g. String name, int age)',
      placeHolder: 'String name, int age',
    });
    if (!fields) return;

    const className = await api.window?.showInputBox?.({
      prompt: 'Class name',
      placeHolder: 'MyClass',
    });
    if (!className) return;

    const params = fields.split(',').map(f => f.trim());
    const assignments = params.map(p => {
      const parts = p.split(/\s+/);
      const name = parts[parts.length - 1];
      return `        this.${name} = ${name};`;
    }).join('\n');

    const code = `
    public ${className}(${fields}) {
${assignments}
    }`;

    if (api.editor && api.editor.insertAtCursor) {
      api.editor.insertAtCursor(code);
    }
  });

  api.commands.register('java.generateToString', async () => {
    const className = await api.window?.showInputBox?.({
      prompt: 'Class name',
      placeHolder: 'MyClass',
    });
    if (!className) return;

    const fields = await api.window?.showInputBox?.({
      prompt: 'Fields (comma separated)',
      placeHolder: 'name, age',
    });
    if (!fields) return;

    const fieldList = fields.split(',').map(f => f.trim());
    const parts = fieldList.map(f => `"${f}=" + ${f}`).join(' + ", " + ');

    const code = `
    @Override
    public String toString() {
        return "${className}{" + ${parts} + '}';
    }`;

    if (api.editor && api.editor.insertAtCursor) {
      api.editor.insertAtCursor(code);
    }
  });

  console.log('[java-support] Commands registered');

  // Settings tab
  if (api && api.settings?.updateTabContent) {
    api.settings.updateTabContent('java-support.settings', {
      sections: [
        {
          title: 'JDK',
          items: [
            { type: 'text', key: 'home', label: 'JAVA_HOME', description: 'Path to JAVA_HOME (empty = use env variable)', placeholder: '/usr/lib/jvm/java-21', defaultValue: '' },
            { type: 'text', key: 'defaultJdkVersion', label: 'JDK Version', description: 'Default JDK version for new projects', placeholder: '21', defaultValue: '21' },
          ],
        },
        {
          title: 'Build',
          items: [
            { type: 'select', key: 'buildTool', label: 'Build Tool', description: 'Default build tool for new projects', defaultValue: 'maven', options: [{ value: 'maven', label: 'Maven' }, { value: 'gradle', label: 'Gradle' }] },
            { type: 'text', key: 'maven.executable', label: 'Maven Executable', description: 'Maven command (mvn or mvnw)', placeholder: 'mvn', defaultValue: 'mvn' },
            { type: 'text', key: 'gradle.executable', label: 'Gradle Executable', description: 'Gradle command (gradle or gradlew)', placeholder: 'gradle', defaultValue: 'gradle' },
          ],
        },
      ],
    });
  }
}

export function deactivate() {
  console.log('[java-support] Extension deactivated');
}

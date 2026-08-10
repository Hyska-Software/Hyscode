import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptDirectory, "..", "apps", "desktop");
const forwardedArguments = process.argv.slice(2);

const listDirectories = (directoryPath) => {
  try {
    return readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directoryPath, entry.name));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

const findVisualStudioDeveloperCommand = () => {
  const candidates = [];
  const configuredInstallation = process.env.VSINSTALLDIR;

  if (configuredInstallation) {
    candidates.push(join(configuredInstallation, "Common7", "Tools", "VsDevCmd.bat"));
  }

  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const visualStudioRoots = [
    join(programFiles, "Microsoft Visual Studio"),
    join(programFilesX86, "Microsoft Visual Studio"),
  ];

  for (const visualStudioRoot of visualStudioRoots) {
    for (const versionDirectory of listDirectories(visualStudioRoot)) {
      for (const editionDirectory of listDirectories(versionDirectory)) {
        candidates.push(join(editionDirectory, "Common7", "Tools", "VsDevCmd.bat"));
      }
    }
  }

  return [...new Set(candidates)]
    .filter((candidate) => existsSync(candidate))
    .sort((left, right) => {
      const leftTime = statSync(left).mtimeMs;
      const rightTime = statSync(right).mtimeMs;
      return rightTime - leftTime;
    })[0];
};

const findNpmCli = () => {
  const configuredNpmCli = process.env.npm_execpath;

  if (configuredNpmCli && existsSync(configuredNpmCli)) {
    return configuredNpmCli;
  }

  const npmLookup = spawnSync("where.exe", ["npm.cmd"], {
    encoding: "utf8",
    windowsHide: true,
  });

  for (const npmCommand of npmLookup.stdout?.split(/\r?\n/) ?? []) {
    const npmDirectory = npmCommand.trim();

    if (!npmDirectory) {
      continue;
    }

    const npmCli = join(dirname(npmDirectory), "node_modules", "npm", "bin", "npm-cli.js");

    if (existsSync(npmCli)) {
      return npmCli;
    }
  }

  throw new Error("The npm CLI could not be located.");
};

const isMsvcEnvironmentReady = (environment) => {
  if (!environment.VCToolsInstallDir || !environment.WindowsSdkDir) {
    return false;
  }

  const linkerCheck = spawnSync(
    environment.ComSpec ?? "cmd.exe",
    ["/d", "/s", "/c", "where link.exe"],
    {
      encoding: "utf8",
      env: environment,
      windowsHide: true,
      windowsVerbatimArguments: process.platform === "win32",
    },
  );

  return linkerCheck.status === 0;
};

const loadMsvcEnvironment = () => {
  if (process.platform !== "win32" || isMsvcEnvironmentReady(process.env)) {
    return process.env;
  }

  const developerCommand = findVisualStudioDeveloperCommand();

  if (!developerCommand) {
    throw new Error(
      "Visual Studio Build Tools with the MSVC C++ workload could not be located. " +
        "Install the Desktop development with C++ workload and run npm run dev again.",
    );
  }

  const commandLine = `call "${developerCommand}" -arch=x64 -host_arch=x64 >nul && set`;
  const result = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
    windowsVerbatimArguments: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const details = result.stderr?.trim() || "Visual Studio environment initialization failed.";
    throw new Error(details);
  }

  const environment = { ...process.env };

  for (const line of result.stdout.split(/\r?\n/)) {
    const separatorIndex = line.indexOf("=");

    if (separatorIndex > 0) {
      const name = line.slice(0, separatorIndex);
      environment[name] = line.slice(separatorIndex + 1);
    }
  }

  if (!isMsvcEnvironmentReady(environment)) {
    throw new Error(
      `Visual Studio was found at ${developerCommand}, but the MSVC linker was not added to the environment.`,
    );
  }

  return environment;
};

const main = () => {
  const environment = loadMsvcEnvironment();
  const npmCommand = process.platform === "win32" ? process.execPath : "npm";
  const npmArguments = process.platform === "win32"
    ? [findNpmCli(), "run", "dev:tauri", "--", ...forwardedArguments]
    : ["run", "dev:tauri", "--", ...forwardedArguments];
  const result = spawnSync(
    npmCommand,
    npmArguments,
    {
      cwd: desktopDirectory,
      env: environment,
      stdio: "inherit",
      windowsHide: false,
    },
  );

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
};

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[hyscode] ${message}`);
  process.exitCode = 1;
}

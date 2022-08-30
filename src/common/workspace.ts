
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'fast-glob';
import * as jsonfile from 'jsonfile';
import { Signal } from 'signals';
import * as vscode from 'vscode';
import { SourceFileConfiguration } from 'vscode-cpptools';
import { Package } from './package';
import { WorkspaceTestAdapter } from './testing/workspace_test_adapter';
import { getExtensionConfiguration } from './configuration';
import { WorkspaceProvider, IWorkspace, WorkspaceTestInterface, WorkspaceTestReport, IPackage } from 'vscode-catkin-tools-api';
import { api } from '../extension';
import { logger } from './logging';
import { MissingExecutableError, runShellCommand, ShellOutput } from './shell_command';

export class Workspace implements IWorkspace {
  public compile_commands: Map<string, JSON> = new Map<string, JSON>();
  public file_to_command: Map<string, JSON> = new Map<string, JSON>();
  public file_to_compile_commands: Map<string, string> =
    new Map<string, string>();
  private watchers: Map<string, fs.FSWatcher> = new Map<string, fs.FSWatcher>();

  public system_include_browse_paths = [];
  public default_system_include_paths = [];

  private build_dir: string = null;
  private ignore_missing_db = false;
  private is_initialized = false;

  public build_commands_changed: Signal = new Signal();
  public system_paths_changed: Signal = new Signal();

  public packages = new Map<string, Package>();

  public test_adapter: WorkspaceTestAdapter = null;

  public onWorkspaceInitialized = new vscode.EventEmitter<boolean>();
  public onTestsSetChanged = new vscode.EventEmitter<boolean>();

  constructor(
    public workspace_provider: WorkspaceProvider,
    public output_channel: vscode.OutputChannel) {
  }

  dispose() { }

  public isInitialized() {
    return this.is_initialized;
  }

  public async reload(): Promise<Workspace> {
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Loading ${this.workspace_provider.getWorkspaceType()} workspace '${await this.getName()}'`,
      cancellable: false
    }, async (progress, token) => {

      progress.report({ increment: 0, message: "Clearing caches" });

      for (var key in this.watchers.keys()) {
        this.watchers.get(key).close();
      }
      this.watchers.clear();
      this.compile_commands.clear();
      this.file_to_command.clear();
      this.file_to_compile_commands.clear();
      this.system_include_browse_paths = [];
      this.default_system_include_paths = [];

      this.packages.clear();

      progress.report({ increment: 0, message: "Initializing workspace" });

      if (!await this.workspace_provider.isInitialized()) {
        const ignore = {
          title: "Abort"
        };
        const init = {
          title: "Initialize workspace with default ros version"
        };
        let result = await vscode.window.showWarningMessage(
          `This workspace is not initialized.`,
          {},
          ignore, init);
        if (result === ignore) {
          return;
        } else if (result === init) {
          this.workspace_provider.initialize([await this.workspace_provider.getDefaultRosWorkspace()]);
        }
      }

      this.workspace_provider.reload();

      this.build_commands_changed.dispatch();

      this.output_channel.appendLine(`Reload ${await this.getName()}`);

      try {
        await this.loadAndWatchCompileCommands();
      } catch (error) {
        if (error.stack !== undefined) {
          logger.error(error.stack);
        }
        vscode.window.showErrorMessage(`cannot load workspace folder: ${error.command} failed with ${error.error}`);
        return;
      }

      progress.report({ increment: 1, message: "Searching packages" });
      const package_xml_pattern = `${await this.workspace_provider.getSrcDir()}/**/package.xml`;
      // TODO: respect CATKIN_IGNORE here
      const package_xml_files = await glob(
        [package_xml_pattern]
      );
      let range_progress_packages_min = 1;
      let range_progress_packages_max = 99;
      let accumulated_progress = 0.0;
      let progress_relative = (1.0 / package_xml_files.length) *
        (range_progress_packages_max - range_progress_packages_min);

      for (const package_xml_entry of package_xml_files) {
        const package_xml = package_xml_entry.toString();
        if (token.isCancellationRequested) {
          break;
        }
        accumulated_progress += progress_relative;
        if (accumulated_progress > 1.0) {
          let integer_progress = Math.floor(accumulated_progress);
          accumulated_progress -= integer_progress;
          progress.report({
            increment: integer_progress,
            message: `Parsing ${path.basename(path.dirname(package_xml))}`
          });
        }
        try {
          await this.loadPackage(package_xml);

        } catch (error) {
          vscode.window.showErrorMessage(`Cannot load package: ${package_xml} failed with ${error}`);
        }
      }
      progress.report({ increment: 1, message: "Building depency graph" });
      await this.buildDependencyGraph();

      this.is_initialized = true;
      progress.report({ increment: 100, message: "Finalizing" });

      this.output_channel.appendLine(`Done loading folder ${await this.getName()} / ${await this.getRootPath()}`);

      this.onWorkspaceInitialized.fire(true);

      return this;
    });
  }

  public async loadPackage(package_xml: fs.PathLike) {
    try {
      let workspace_package = await Package.loadFromXML(package_xml, this);
      this.packages.set(workspace_package.getName(), workspace_package);
      return workspace_package;
    } catch (err) {
      logger.error(`Error parsing package ${package_xml}: ${err}`);
      return null;
    }
  }


  loadPackageTests(workspace_package: IPackage,
    outline_only: boolean,
    build_dir?: fs.PathLike,
    devel_dir?: fs.PathLike
  ): Promise<void> {
    return this.test_adapter.updatePackageTests(workspace_package, outline_only, build_dir, devel_dir);
  }

  public async locatePackageXML(package_name: String) {
    const package_xml_pattern = `${await this.workspace_provider.getSrcDir()}/**/package.xml`;
    const package_xml_files = await glob(
      [package_xml_pattern]
    );
    for (let package_xml_entry of package_xml_files) {
      const package_xml = package_xml_entry.toString();
      let name = await Package.getNameFromPackageXML(package_xml);
      if (name === package_name) {
        return package_xml;
      }
    }
    return null;
  }

  public async buildDependencyGraph() {
    for (const [_, workspace_package] of this.packages) {
      for (const depency of workspace_package.dependencies) {
        let pkg = this.getPackage(depency);
        if (pkg !== undefined) {
          pkg.dependees.push(workspace_package.getName());
        }
      }
    }
  }

  public async iteratePossibleSourceFiles(
    file: vscode.Uri,
    async_filter: (uri: vscode.Uri) => Promise<boolean>
  ): Promise<boolean> {
    let checked_pkgs = [];
    const owner_package = this.getPackageContaining(file);
    if (owner_package !== undefined) {
      logger.debug(`Package ${await owner_package.getRelativePath()} owns file ${file.toString()}.`);
      const stop = await owner_package.iteratePossibleSourceFiles(file, async_filter);
      if (stop) {
        return true;
      }
      checked_pkgs.push(owner_package.getName());
      logger.debug(`Package ${await owner_package.getRelativePath()} does not use file ${file.toString()}.`);

      const resursive_search = getExtensionConfiguration('recursiveHeaderParsingEnabled', false);
      const found_match = await this.iterateDependentPackages(owner_package, resursive_search, async (dependent_package: Package) => {
        if (checked_pkgs.findIndex(e => e === dependent_package.getName()) < 0) {
          const stop = await dependent_package.iteratePossibleSourceFiles(file, async_filter);
          if (stop) {
            return true;
          }
          checked_pkgs.push(dependent_package.getName());
        }

        logger.debug(`No usage of ${file.toString()} found.`);
        return false;
      });
      if (found_match) {
        return true;
      }
    }
    logger.debug(`No dependee of ${file.fsPath.toString()} uses the file.`);
    return false;
  }

  public async iterateDependentPackages(
    workspace_package: Package,
    resursive_search: boolean,
    async_filter: (workspace_package: Package) => Promise<boolean>
  ): Promise<boolean> {
    let checked_pkgs = new Set<string>();
    let unchecked_pkgs = [];
    for (const dep_name of workspace_package.dependees) {
      unchecked_pkgs.push(dep_name);
    }

    while (unchecked_pkgs.length > 0) {
      let dep_name = unchecked_pkgs[0];
      unchecked_pkgs = unchecked_pkgs.slice(1);
      if (!checked_pkgs.has(dep_name)) {
        // do the check
        checked_pkgs.add(dep_name);
        const dependency = this.getPackage(dep_name);
        if (dependency !== undefined) {
          logger.debug(`Checking ${dependency.name}`);
          let stop = await async_filter(dependency);
          if (stop) {
            return true;
          }
          if (resursive_search) {
            for (const dep_name of dependency.dependees) {
              unchecked_pkgs.push(dep_name);
            }
          }
        }
      }
    }
    return false;
  }

  public getSourceFileConfiguration(commands): SourceFileConfiguration {
    let args = commands.command.split(' ');

    let compiler = args[0];
    let includePaths = [];
    let defines = [];

    if (this.default_system_include_paths.length === 0) {
      this.parseCompilerDefaults(compiler, args.slice(1));
    }

    this.output_channel.appendLine(`Analyzing ${commands.command}`);

    // Parse the includes and defines from the compile commands
    let new_system_path_found = false;
    for (let i = 1; i < args.length; ++i) {
      let opt = args[i];
      this.output_channel.appendLine(`-${opt}`);
      if (opt.startsWith('-I')) {
        let path = opt.slice(2);
        this.output_channel.appendLine(`   -> add path ${path}`);
        includePaths.push(path);
        if (!this.isWorkspacePath(path)) {
          if (this.system_include_browse_paths.indexOf(path) < 0) {
            this.output_channel.appendLine(`   -> add system_include_browse_path ${path}`);
            this.system_include_browse_paths.push(path);
            new_system_path_found = true;
          }
        }
      } else if (opt === '-isystem') {
        ++i;
        let path = args[i];
        this.output_channel.appendLine(`   -> add system path ${path}`);
        includePaths.push(path);
        if (!this.isWorkspacePath(path)) {
          if (this.system_include_browse_paths.indexOf(path) < 0) {
            this.output_channel.appendLine(`   -> add system_include_browse_path ${path}`);
            this.system_include_browse_paths.push(path);
            new_system_path_found = true;
          }
        }
      } else if (opt.startsWith('-isystem=')) {
        let path = opt.slice(9);
        this.output_channel.appendLine(`   -> add system path ${path}`);
        includePaths.push(path);
        if (!this.isWorkspacePath(path)) {
          if (this.system_include_browse_paths.indexOf(path) < 0) {
            this.output_channel.appendLine(`   -> add system_include_browse_path ${path}`);
            this.system_include_browse_paths.push(path);
            new_system_path_found = true;
          }
        }
      } else if (opt.startsWith('-D')) {
        let define = opt.slice(2).replace(/\\/g, "");
        defines.push(define);
        this.output_channel.appendLine(`   -> add define ${define}`);
      }
    }
    if (new_system_path_found) {
      this.system_paths_changed.dispatch();
    }

    for (var dir of this.default_system_include_paths) {
      includePaths.push(dir);
    }

    // Construct the combined source file configuration
    const ret: SourceFileConfiguration = {
      standard: getExtensionConfiguration('cppStandard'),
      intelliSenseMode: getExtensionConfiguration('intelliSenseMode'),
      includePath: includePaths,
      defines: defines,
      compilerPath: compiler,
    };
    return ret;
  }

  private isWorkspacePath(path: string): boolean {
    if (vscode.workspace.workspaceFolders === undefined) {
      return false;
    }
    for (var ws of vscode.workspace.workspaceFolders) {
      let base = ws.uri.fsPath;
      if (!base.endsWith('/')) {
        base += '/';
      }
      base += 'src';
      if (path.startsWith(base)) {
        return true;
      }
    }
    return false;
  }

  private getPackage(name: string): Package {
    return this.packages.get(name);
  }

  public getPackageContaining(file: vscode.Uri): Package {
    for (let [_, pkg] of this.packages) {
      if (pkg.containsFile(file)) {
        return pkg;
      }
    }
    return undefined;
  }

  private parseCompilerDefaults(compiler: string, args: string[]) {
    this.default_system_include_paths = [];

    let compiler_path = compiler.split('/');
    let compiler_name = compiler_path[compiler_path.length - 1];

    if (compiler_name === 'nvcc') {
      this.parseCompilerDefaultsNvcc(compiler);
    } if (compiler_name.indexOf('ccache') >= 0) {
      this.parseCompilerDefaultsCcache(compiler, args);
    } else {
      this.parseCompilerDefaultsCpp(compiler);
    }

    this.system_paths_changed.dispatch();
  }

  private parseCompilerDefaultsCpp(compiler: string) {
    // Parse the default includes by invoking the compiler
    let options:
      child_process.ExecSyncOptionsWithStringEncoding = { 'encoding': 'utf8' };
    let stdout = child_process.execSync(
      compiler + ' -xc++ -E -v /dev/null -o /dev/null 2>&1', options);
    let private_includes = false;
    let public_includes = false;
    for (var line of stdout.split('\n')) {
      if (line.match('#include ".*starts here')) {
        private_includes = true;
        public_includes = false;
        continue;
      } else if (line.match('#include <.*starts here')) {
        private_includes = false;
        public_includes = true;
        continue;
      }
      if (line.match('End of search list')) {
        private_includes = false;
        public_includes = false;
        continue;
      }

      if (private_includes || public_includes) {
        this.default_system_include_paths.push(line.trim());
      }
    }
  }

  private parseCompilerDefaultsCcache(caching_compiler: string, args: string[]) {
    if (args.length === 0) {
      logger.error(`Cannot determine defaults for compiler ${caching_compiler} without any further arguments}`);
      return;
    }
    logger.debug(`Defering default flags from cached compiler ${caching_compiler} to ${args[0]}`);
    this.parseCompilerDefaults(args[0], args.slice(1));
  }

  private parseCompilerDefaultsNvcc(compiler: string) {
    // Parse the default includes by invoking the compiler
    let options:
      child_process.ExecSyncOptionsWithStringEncoding = { 'encoding': 'utf8' };
    try {
      child_process.execSync(compiler + ' --dryrun -v /dev/null 1>&2', options);
    } catch (err) {
      for (var line of err.message.split('\n')) {
        let match = line.match(/^#\$ INCLUDES="(.*)"\s*$/);
        if (match) {
          for (let path of match[1].split("-I")) {
            let trimmed = path.trim();
            if (trimmed.length > 0) {
              this.default_system_include_paths.push(trimmed);
            }
          }
        }
      }
    }
  }

  private async updateDatabase(db_file: string): Promise<boolean> {
    logger.debug('updating with file', db_file);
    if (!fs.existsSync(db_file)) {
      logger.debug(`${db_file} does not exist anymore`);
      for (let [file, db] of this.file_to_compile_commands.entries()) {
        if (db === db_file) {
          this.file_to_command.delete(file);
          this.file_to_compile_commands.delete(file);
        }
      }
      this.build_commands_changed.dispatch();
      return true;
    }

    let db_part = await jsonfile.readFile(db_file);
    this.compile_commands.set(db_file, db_part);
    let change = false;
    for (var index in db_part) {
      let cmd = db_part[index];
      const file = cmd['file'];
      if (this.file_to_command.get(file) !== cmd) {
        this.file_to_command.set(file, cmd);
        change = true;
        this.file_to_compile_commands.set(file, db_file);
      }
    }
    if (change) {
      logger.debug('Signalling change in config');
      this.build_commands_changed.dispatch();
    }
    return change;
  }

  public collectCompileCommands() {
    let result = [];
    for (const entry of this.compile_commands) {
      result = result.concat(entry[1]);
    }
    return result;
  }

  private async loadAndWatchCompileCommands() {
    let build_dir = await this.workspace_provider.getBuildDir();
    if (build_dir === null || build_dir.length === 0) {
      vscode.window.showErrorMessage('Cannot determine build directory');
      return;
    }
    let db_found = false;
    if (fs.existsSync(build_dir)) {
      if (this.build_dir !== build_dir) {
        this.build_dir = build_dir;

        fs.watch(build_dir, async (eventType, filename) => {
          let abs_file = this.build_dir + '/' + filename;
          if (eventType === 'rename') {
            if (fs.existsSync(abs_file)) {
              if (fs.lstatSync(abs_file).isDirectory()) {
                // new package created
                this.startWatchingPackageBuildDir(abs_file);
                logger.debug(`New package ${filename}`);

                let package_xml = await this.locatePackageXML(filename);
                let workspace_package = await this.loadPackage(package_xml);
                if (workspace_package && workspace_package.has_tests) {
                  await this.test_adapter.updatePackageTests(workspace_package, true);
                  // this.test_adapter.updateSuiteSet();
                  logger.debug(`New package ${workspace_package.name} found and ${workspace_package.package_test_suite.children === null ?
                    "unknown" :
                    workspace_package.package_test_suite.children.length} tests added`);
                } else {
                  logger.debug(`New package ${workspace_package.name} but no package.xml found`);
                }
              }
            } else {
              // package cleaned
              logger.debug('Package', filename, 'was cleaned');
              this.stopWatching(abs_file);
            }
          }
        });
      }

      let expr = this.build_dir + '/**/compile_commands.json';

      const entries = await glob([expr]);
      for (let file of entries) {
        this.startWatchingCompileCommandsFile(file.toString());
      }
      db_found = entries.length !== 0;
      if (!db_found) {
        logger.warn("No compile_commands.json file found");
      }
    }
    if (api.test_mode_enabled) {
      return false;
    }

    if (!db_found && !this.ignore_missing_db) {
      let ask_trigger_build = !db_found;
      let args = await this.workspace_provider.getCmakeArguments();
      if (args !== undefined && args.indexOf("CMAKE_EXPORT_COMPILE_COMMANDS") < 0) {
        const ignore = {
          title: "Ignore this"
        };
        const update = {
          title: "Update workspace config"
        };
        let result = await vscode.window.showWarningMessage(
          `CMAKE_EXPORT_COMPILE_COMMANDS is not enabled in your workspace build configuration.`,
          {},
          ignore, update);

        if (result === ignore) {
          this.ignore_missing_db = true;
          return;
        } else if (result === update) {
          if (!this.workspace_provider.enableCompileCommandsGeneration()) {
            vscode.window.showWarningMessage("Failed to enable compile commands generation, see logs");
          }
          ask_trigger_build = true;
        }
      }

      if (ask_trigger_build) {
        const ignore = {
          title: "Ignore this"
        };
        const build = {
          title: "Build workspace"
        };
        let items = [ignore];
        let build_task = await this.workspace_provider.getBuildTask();
        if (build_task !== undefined) {
          items.push(build);
        }
        let result = await vscode.window.showWarningMessage(
          `No compile_commands.json files found for ${await this.workspace_provider.getSrcDir()}.\n` +
          `Please build your workspace to generate the files.`,
          {},
          ...items);
        if (result === ignore) {
          this.ignore_missing_db = true;
        } else if (result === build) {
          vscode.tasks.executeTask(build_task);
        }
      }
      return;
    }

  }


  public async getBuildDir(): Promise<fs.PathLike> {
    return this.workspace_provider.getBuildDir();
  }
  public async getDevelDir(): Promise<fs.PathLike> {
    return this.workspace_provider.getDevelDir();
  }
  public async getInstallDir(): Promise<fs.PathLike> {
    return this.workspace_provider.getInstallDir();
  }

  public async getRootPath(): Promise<fs.PathLike> {
    return this.workspace_provider.getRootPath();
  }

  public async getName(): Promise<string> {
    const root_path = await this.getRootPath();
    if (root_path === undefined) {
      throw Error("Failed to get root path of the current workspace");
    }
    return path.basename(root_path.toString());
  }


  public async getSetupShell(): Promise<string> {
    const shell_type = getExtensionConfiguration('shell');
    const use_install_space = getExtensionConfiguration('useInstallSpace');
    if (use_install_space) {
      const install_dir = await this.workspace_provider.getInstallDir();
      let setup = install_dir + `/setup.${shell_type}`;
      if (fs.existsSync(setup)) {
        return setup;
      }
    }
    const devel_dir = await this.workspace_provider.getDevelDir();
    return devel_dir + `/setup.${shell_type}`;
  }

  public async getRuntimeEnvironment(): Promise<[string, string][]> {
    let environment: [string, string][] = [];
    let env_command = await this.makeCommand(`env`);
    const env_output: ShellOutput | Error = await runShellCommand(env_command, environment, await this.getRootPath());
    if (env_output instanceof Error) {
      if (env_output instanceof MissingExecutableError) {
        throw Error(`Cannot determine environment, shell cannot be created: ${env_output.executable}`);
      } else {
        throw Error(`Cannot determine environment: ${env_output.message}`);
      }
    }
    environment = env_output.stdout.split("\n").filter((v) => v.indexOf("=") > 0).map((env_entry) => {
      let [name, value] = env_entry.split("=");
      return [name, value];
    });

    return environment;
  }

  private startWatchingPackageBuildDir(file: string) {
    logger.debug('watching directory', file);
    this.stopWatching(file);
    this.watchers.set(file, fs.watch(file, (eventType, filename) => {
      if (filename === 'compile_commands.json') {
        logger.debug(
          'File', filename, 'in package', file, 'changed with', eventType);
        let db_file = file + '/' + filename;
        if (fs.existsSync(db_file)) {
          this.startWatchingCompileCommandsFile(db_file);
        }
      }
    }));
  }

  private stopWatching(file: string) {
    if (this.watchers.has(file)) {
      logger.debug('stop watching', file);
      this.watchers.get(file).close();
      this.watchers.delete(file);
    }
  }

  private startWatchingCompileCommandsFile(file: string) {
    this.updateDatabase(file);
    logger.debug('watching file', file);
    this.stopWatching(file);
    this.watchers.set(file, fs.watch(file, (eventType, filename) => {
      if (filename) {
        logger.debug(`Database file ${file} changed: ${eventType}`);
        this.updateDatabase(file);
      }
    }));
  }

  public async makeCommand(payload: string): Promise<string> {
    const setup_shell = await this.getSetupShell();
    let command = `source ${setup_shell} > /dev/null 2 >& 1;`;
    command += `pushd . > /dev/null; cd "${await this.getRootPath()}"; `;
    command += `${payload} `;
    if (!payload.endsWith(";")) {
      command += "; ";
    }
    command += "EXIT_CODE=$?; ";
    command += `popd > /dev/null; [ "$EXIT_CODE" = "0" ] || exit $EXIT_CODE;`;
    return command;
  }

  public async runTest(id: string, test_run: vscode.TestRun): Promise<WorkspaceTestReport> {
    return this.test_adapter.runTestWithId(id, test_run);
  }
}


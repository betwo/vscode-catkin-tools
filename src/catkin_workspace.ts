
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'fast-glob';
import * as jsonfile from 'jsonfile';
import * as xml from 'fast-xml-parser';
import { Signal } from 'signals';
import * as vscode from 'vscode';
import { SourceFileConfiguration } from 'vscode-cpptools';
import { CatkinPackage } from './catkin_package';
import { EntryItem } from 'fast-glob/out/types/entries';
import { runCatkinCommand, ShellOutput } from './catkin_command';

export class CatkinWorkspace {
  public workspace: vscode.WorkspaceFolder;

  public compile_commands: Map<string, JSON> = new Map<string, JSON>();
  public file_to_command: Map<string, JSON> = new Map<string, JSON>();
  public file_to_compile_commands: Map<string, string> =
    new Map<string, string>();
  private watchers: Map<string, fs.FSWatcher> = new Map<string, fs.FSWatcher>();

  public system_include_browse_paths = [];
  public default_system_include_paths = [];

  private build_dir: string = null;
  private warned = false;

  public build_commands_changed: Signal = new Signal();
  public system_paths_changed: Signal = new Signal();

  public packages: CatkinPackage[] = [];

  private output_channel: vscode.OutputChannel;

  constructor(
    workspace: vscode.WorkspaceFolder, outputChannel: vscode.OutputChannel) {
    this.workspace = workspace;
    this.output_channel = outputChannel;
  }

  dispose() { }

  public async reload(): Promise<CatkinWorkspace> {
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Loading catkin workspace",
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

      this.packages = [];

      this.build_commands_changed.dispatch();

      await this.loadAndWatchCompileCommands();

      progress.report({ increment: 1, message: "Searching packages" });
      const packages = await vscode.workspace.findFiles("**/package.xml");
      let range_progress_packages_min = 1;
      let range_progress_packages_max = 99;
      let accumulated_progress = 0.0;
      let progress_relative = (1.0 / packages.length) *
        (range_progress_packages_max - range_progress_packages_min);

      for (let package_xml of packages) {
        if (token.isCancellationRequested) {
          break;
        }
        accumulated_progress += progress_relative;
        if (accumulated_progress > 1.0) {
          let integer_progress = Math.floor(accumulated_progress);
          accumulated_progress -= integer_progress;
          progress.report({
            increment: integer_progress,
            message: `Parsing ${path.basename(path.dirname(package_xml.path))}`
          });
        }
        try {
          let dom = xml.parse(fs.readFileSync(package_xml.fsPath).toString());
          if (dom !== undefined && dom !== "" && 'package' in dom) {
            let src_path = path.dirname(package_xml.fsPath);
            let relative_path = src_path.replace(vscode.workspace.rootPath + '/', "");
            let cmake_lists_path = path.join(src_path, "CMakeLists.txt");
            let item: CatkinPackage = {
              name: dom['package']['name'],
              package_xml: dom,
              path: src_path,
              relative_path: relative_path,
              has_tests: false
            };

            if (fs.existsSync(cmake_lists_path)) {
              item.has_tests = await this.parseCmakeListsForTests(item);
            }

            this.packages.push(item);
          }
        } catch (err) {
          console.log(`Error parsing package ${package_xml}: ${err}`);
        }
      }
      progress.report({ increment: 100, message: "Finalizing" });
      if (!token.isCancellationRequested) {
        vscode.commands.executeCommand('test-explorer.reload');
      }
      return this;
    });
  }

  private async parseCmakeListsForTests(item): Promise<boolean> {
    let config = vscode.workspace.getConfiguration('catkin_tools');
    let test_regexes = [];
    for (let expr of config['gtestMacroRegex']) {
      test_regexes.push(new RegExp(`.*(${expr})`));
    }

    let cmake_files = await glob.async(
      [`${vscode.workspace.rootPath}/${item.relative_path}/**/CMakeLists.txt`]
    );
    for (let cmake_file of cmake_files) {
      let data = fs.readFileSync(cmake_file.toString());
      let cmake = data.toString();
      for (let test_regex of test_regexes) {
        for (let row of cmake.split('\n')) {
          let tests = row.match(test_regex);
          if (tests) {
            item.has_tests = true;
            return true;
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
    let config = vscode.workspace.getConfiguration('catkin_tools');
    const ret: SourceFileConfiguration = {
      standard: config['cppStandard'],
      intelliSenseMode: config['intelliSenseMode'],
      includePath: includePaths,
      defines: defines,
      compilerPath: compiler,
    };
    return ret;
  }

  private isWorkspacePath(path: string): boolean {
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

  private parseCompilerDefaults(compiler: string, args: string[]) {
    this.default_system_include_paths = [];

    if (compiler.endsWith('nvcc')) {
      this.parseCompilerDefaultsNvcc(compiler);
    } if (compiler.indexOf('ccache') >= 0) {
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
      console.log(line);
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
      console.log(`Cannot determine defaults for compiler ${caching_compiler} without any further arguments}`);
      return;
    }
    console.log(`Defering default flags from cached compiler ${caching_compiler} to ${args[0]}`);
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
    console.log('updating with file', db_file);
    if (!fs.existsSync(db_file)) {
      console.log(`${db_file} does not exist anymore`);
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
      console.log('Signalling change in config');
      this.build_commands_changed.dispatch();
    }
    return change;
  }

  private async loadAndWatchCompileCommands() {
    let build_dir = await this.getBuildDir();
    if (build_dir === null) {
      vscode.window.showErrorMessage('Cannot determine build directory');
      return;
    }
    if (!fs.existsSync(build_dir)) {
      vscode.window.showErrorMessage(
        'Build directory ' + build_dir + ' does not exist');
      return;
    }
    if (this.build_dir !== build_dir) {
      this.build_dir = build_dir;

      fs.watch(build_dir, (eventType, filename) => {
        let abs_file = this.build_dir + '/' + filename;
        if (eventType === 'rename') {
          if (fs.existsSync(abs_file)) {
            if (fs.lstatSync(abs_file).isDirectory()) {
              // new package created
              console.log('New package', filename);
              this.startWatchingCatkinPackageBuildDir(abs_file);
            }
          } else {
            // package cleaned
            console.log('Package', filename, 'was cleaned');
            this.stopWatching(abs_file);
          }
        }
      });
    }

    let expr = this.build_dir + '/**/compile_commands.json';

    const entries = await glob.async([expr]);
    if (entries.length === 0 && !this.warned) {
      this.warned = true;
      vscode.window.showWarningMessage(
        'No compile_commands.json file found in the workspace.\nMake sure that CMAKE_EXPORT_COMPILE_COMMANDS is on.');
      return;
    }

    for (let file of entries) {
      this.startWatchingCompileCommandsFile(file.toString());
    }

  }

  public async getBuildDir(): Promise<string> {
    const output: ShellOutput = await runCatkinCommand('locate -b');
    return output.stdout.split('\n')[0];
  }
  public async getDevelDir(): Promise<string> {
    const output: ShellOutput = await runCatkinCommand('locate -d');
    return output.stdout.split('\n')[0];
  }
  public async getInstallDir(): Promise<string> {
    const output: ShellOutput = await runCatkinCommand('locate -i');
    return output.stdout.split('\n')[0];
  }

  public async getSetupBash(): Promise<string> {
    const install_dir = await this.getInstallDir();
    let setup = install_dir + '/setup.bash';
    if (fs.existsSync(setup)) {
      return setup;
    }
    const devel_dir = await this.getDevelDir();
    return devel_dir + '/setup.bash';
  }

  private startWatchingCatkinPackageBuildDir(file: string) {
    console.log('watching directory', file);
    this.stopWatching(file);
    this.watchers.set(file, fs.watch(file, (eventType, filename) => {
      if (filename === 'compile_commands.json') {
        console.log(
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
      console.log('stop watching', file);
      this.watchers.get(file).close();
      this.watchers.delete(file);
    }
  }

  private startWatchingCompileCommandsFile(file: string) {
    this.updateDatabase(file);
    console.log('watching file', file);
    this.stopWatching(file);
    this.watchers.set(file, fs.watch(file, (eventType, filename) => {
      if (filename) {
        console.log('Database file', file, 'changed');
        this.updateDatabase(file);
      }
    }));
  }
}
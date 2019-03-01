
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as glob from 'glob';
import * as jsonfile from 'jsonfile';
import * as vscode from 'vscode';
import {CppToolsApi, CustomConfigurationProvider, getCppToolsApi, SourceFileConfiguration, SourceFileConfigurationItem, Version, WorkspaceBrowseConfiguration} from 'vscode-cpptools';

let provider: CatkinToolsProvider = null;

export let status_bar_item =
    vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
let status_bar_prefix = 'catkin workspace: ';
status_bar_item.text = status_bar_prefix + 'initialized';
status_bar_item.command = 'extension.b2.catkin_tools.reload_compile_commands';
status_bar_item.tooltip = 'Reload the compile_commands.json data bases';
status_bar_item.show();

// Worker class that implements a C++ configuration provider
export class CatkinToolsProvider implements CustomConfigurationProvider {
  name: string = 'catkin_tools';
  extensionId: string = 'b2.catkin_tools';

  public workspace: vscode.WorkspaceFolder;
  private disposables: vscode.Disposable[] = [];
  private cppToolsApi: CppToolsApi;

  private compile_commands: Map<string, JSON> = new Map<string, JSON>();
  private file_to_command: Map<string, JSON> = new Map<string, JSON>();
  private file_to_compile_commands: Map<string, string> =
      new Map<string, string>();
  private watchers: Map<string, fs.FSWatcher> = new Map<string, fs.FSWatcher>();

  private build_dir: string = null;
  private warned = false;

  constructor(workspace: vscode.WorkspaceFolder, cppToolsApi: CppToolsApi) {
    this.workspace = workspace;
    this.cppToolsApi = cppToolsApi;
  }

  dispose() {}

  public loadDataBases() {
    this.reload();
  }

  public async canProvideConfiguration(
      uri: vscode.Uri,
      token?: vscode.CancellationToken|undefined): Promise<boolean> {
    const fileWp = vscode.workspace.getWorkspaceFolder(uri);
    if (fileWp === undefined || fileWp.index !== this.workspace.index) {
      console.log('Cannot provide compile flags for', uri.fsPath);
      return false;
    }
    console.log('Can provide compile flags for', uri.fsPath);
    return true;
  }

  public async provideConfigurations(
      uris: vscode.Uri[], token?: vscode.CancellationToken|undefined):
      Promise<SourceFileConfigurationItem[]> {
    const ret: SourceFileConfigurationItem[] = [];

    for (var file of uris) {
      console.log('Providing compile flags for', file.fsPath);
      let commands = this.file_to_command[file.fsPath];
      if (commands !== undefined) {
        ret.push({
          uri: file,
          configuration: this.getSourceFileConfiguration(commands)
        });

        status_bar_item.text = status_bar_prefix + ' (' +
            this.file_to_compile_commands[file.fsPath] + ')';
      }
    }
    console.log(ret);
    return ret;
  }

  public async canProvideBrowseConfiguration(token?: vscode.CancellationToken):
      Promise<boolean> {
    return true;
  }
  public async provideBrowseConfiguration(token?: vscode.CancellationToken):
      Promise<WorkspaceBrowseConfiguration> {
    let paths = [];
    for (var f of vscode.workspace.workspaceFolders) {
      paths.push(f.uri.fsPath);
    }
    return {browsePath: paths};
  }

  public reload() {
    for (var key in this.watchers.keys()) {
      this.watchers[key].close();
    }
    this.watchers.clear();
    this.compile_commands.clear();
    this.file_to_command.clear();
    this.file_to_compile_commands.clear();

    console.log('Cleared caches');

    this.cppToolsApi.didChangeCustomConfiguration(this);

    this.loadAndWatchCompileCommands();
  }



  private getSourceFileConfiguration(commands): SourceFileConfiguration {
    let args = commands.command.split(' ');

    let compiler = args[0];
    let includePaths = [];
    let defines = [];

    for (var opt of args.slice(1)) {
      if (opt.slice(0, 2) === '-I') {
        includePaths.push(opt.slice(2));
      } else if (opt.slice(0, 2) === '-D') {
        defines.push(opt.slice(2));
      }
    }

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

  private updateDatabase(db_file: string): any {
    console.log('updating with file', db_file);
    let db_part = jsonfile.readFileSync(db_file);
    this.compile_commands[db_file] = db_part;
    let change = false;
    for (var index in db_part) {
      let cmd = db_part[index];
      const file = cmd['file'];
      if (this.file_to_command[file] !== cmd) {
        this.file_to_command[file] = cmd;
        change = true;
        this.file_to_compile_commands[file] = db_file;
      }
    }
    if (change) {
      console.log('Signalling change in config');
      this.cppToolsApi.didChangeCustomConfiguration(this);
    }
  }

  private loadAndWatchCompileCommands() {
    let build_dir = this.getBuildDir();
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

    const mg = new glob.Glob(expr, {mark: true}, (er, matches) => {
      if (er) {
        vscode.window.showErrorMessage(er.message);
        return;
      }
      if (matches.length === 0 && !this.warned) {
        this.warned = true;
        vscode.window.showWarningMessage(
            'No compile_commands.json file found in the workspace.\nMake sure that CMAKE_EXPORT_COMPILE_COMMANDS is on.');
        return;
      }

      for (let file of matches) {
        console.log('Glob result:', file);
        this.startWatchingCompileCommandsFile(file);
      }
    });
  }

  private getBuildDir() {
    let ws = vscode.workspace.rootPath;
    let options: child_process.ExecSyncOptionsWithStringEncoding = {
      'cwd': ws,
      'encoding': 'utf8'
    };
    let stdout = child_process.execSync('catkin locate -b', options);
    return stdout.split('\n')[0];
  }

  private startWatchingCatkinPackageBuildDir(file: string) {
    console.log('watching directory', file);
    this.stopWatching(file);
    this.watchers[file] = fs.watch(file, (eventType, filename) => {
      if (filename === 'compile_commands.json') {
        console.log(
            'File', filename, 'in package', file, 'changed with', eventType);
        let db_file = file + '/' + filename;
        if (fs.existsSync(db_file)) {
          this.startWatchingCompileCommandsFile(db_file);
        }
      }
    });
  }

  private stopWatching(file: string) {
    if (this.watchers.has(file)) {
      console.log('stop watching', file);
      this.watchers[file].close();
      this.watchers.delete(file);
    }
  }

  private startWatchingCompileCommandsFile(file: string) {
    this.updateDatabase(file);
    console.log('watching file', file);
    this.stopWatching(file);
    this.watchers[file] = fs.watch(file, (eventType, filename) => {
      if (filename) {
        console.log('Database file', file, 'changed');
        this.updateDatabase(file);
      }
    });
  }
}

// Public functions

export function initialize() {
  let config = vscode.workspace.getConfiguration('clang');
  if (config['completion'] !== undefined && config['completion']['enable']) {
    let ack: string = 'Ok';
    let msg =
        'You seem to have clang.autocomplete enabled. This interferes with catkin-tools auto completion.\n' +
        'To disable it, change the setting "clang.completion.enable" to false.';
    vscode.window.showInformationMessage(msg, ack);
  }

  registerProviders();
}

export async function registerProviders() {
  let api: CppToolsApi|undefined = await getCppToolsApi(Version.v2);
  if (api) {
    if (api.notifyReady) {
      provider =
          new CatkinToolsProvider(vscode.workspace.workspaceFolders[0], api);
      // Inform cpptools that a custom config provider will be able to service
      // the current workspace.

      api.registerCustomConfigurationProvider(provider);
      provider.loadDataBases();
      api.notifyReady(provider);

    } else {
      vscode.window.showInformationMessage(
          'Catkin tools only supports C/C++ API 2.0 or later.');
    }
  }
}
export function reloadCompileCommand() {
  status_bar_item.text = status_bar_prefix + 'reloading';

  provider.reload();

  status_bar_item.text = status_bar_prefix + 'reload complete';
}

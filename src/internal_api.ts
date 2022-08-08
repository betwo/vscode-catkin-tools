import * as vscode from 'vscode';
import { VERSION, API, IWorkspaceManager, IWorkspace, ITestParser, IPackage } from 'vscode-catkin-tools-api';
import { WorkspaceManager } from './workspace_manager';
import { test_parsers } from "./common/testing/cmake_test_parser";
import { api, runTask } from './extension';
import { CatkinToolsTerminal } from './catkin_tools/catkin_tools_terminal';
import { logger } from './common/logging';

export class InternalAPI implements API {
  workspace_manager: WorkspaceManager;
  test_mode_enabled = false;

  constructor() {
    logger.debug(`Providing API for version: ${VERSION}`);
    this.workspace_manager = new WorkspaceManager();

    vscode.tasks.onDidStartTask(e => {
      logger.debug(`Task started: ${e.execution.task.name}`);
    });
    vscode.tasks.onDidEndTask(e => {
      logger.debug(`Task ended: ${e.execution.task.name}`);
    });
    vscode.tasks.onDidEndTaskProcess(e => {
      logger.debug(`Task process ended: ${e.execution.task.name}, exit code: ${e.exitCode}`);
    });
  }

  public async reload(): Promise<void> {
    return api.getWorkspaceManager().reloadAllWorkspaces();
  }

  public async registerWorkspace(context: vscode.ExtensionContext,
    root: vscode.WorkspaceFolder,
    output_channel: vscode.OutputChannel): Promise<void> {
    return await this.workspace_manager.registerWorkspace(context, root, output_channel);
  }

  public async unregisterWorkspace(context: vscode.ExtensionContext,
    root: vscode.WorkspaceFolder): Promise<void> {
    return await this.workspace_manager.unregisterWorkspace(context, root);
  }

  public getWorkspaceManager(): IWorkspaceManager {
    return this.workspace_manager;
  }

  public getWorkspaces(): Map<vscode.WorkspaceFolder, IWorkspace> {
    return this.workspace_manager.workspaces;
  }

  public getWorkspace(workspace_folder: vscode.WorkspaceFolder) {
    return this.workspace_manager.getWorkspace(workspace_folder);
  }

  public registerTestParser(parser: ITestParser): vscode.Disposable {
    test_parsers.push(parser);

    let scope = this;
    return {
      dispose: function () {
        const before = test_parsers.length;
        scope.unregisterTestParser(parser);

      }
    };
  }
  public unregisterTestParser(parser: ITestParser) {
    for (let index = 0; index < test_parsers.length; ++index) {
      if (test_parsers[index] === parser) {
        test_parsers.splice(index, 1);
        return;
      }
    }
  }

  public async ensureWorkspaceInitialized(): Promise<void> {
    return;
  }

  public async cleanWorkspace(workspace: IWorkspace): Promise<boolean> {
    logger.debug(`Cleaning workspace ${await workspace.getName()}`);
    let clean_task = await workspace.workspace_provider.getCleanTask();
    if (clean_task === undefined) {
      return false;
    }

    return runTask(clean_task);
  }

  public async buildWorkspace(workspace: IWorkspace): Promise<boolean> {
    logger.debug(`Building workspace ${await workspace.getName()}`);
    let build_task = await workspace.workspace_provider.getBuildTask();
    if (build_task === undefined) {
      logger.error("Failed to get build task");
      return false;
    }

    return runTask(build_task);
  }

  public async buildWorkspaceTests(workspace: IWorkspace): Promise<boolean> {
    logger.debug(`Building workspace tests ${await workspace.getName()}`);
    let build_task = await workspace.workspace_provider.getBuildTestsTask();
    if (build_task === undefined) {
      logger.error("Failed to get build_test task");
      return false;
    }

    return runTask(build_task);
  }

  public async buildPackage(pkg: IPackage): Promise<boolean> {
    logger.silly(`Building package ${pkg.getName()}`);

    let opts: vscode.ExtensionTerminalOptions = {
      name: "catkin",
      pty: new CatkinToolsTerminal(pkg.workspace, ["build", pkg.name, ])
    };
    const terminal = vscode.window.createTerminal(opts);
    terminal.show();
    return new Promise<boolean>((resolve, reject) => {
      vscode.window.onDidCloseTerminal((t) => {
        if(terminal === t) {
          terminal.dispose();
          resolve(true);
        }
      });
    });
  }

  public async buildPackageTests(pkg: IPackage): Promise<boolean> {
    logger.silly(`Building package tests ${pkg.getName()}`);

    let opts: vscode.ExtensionTerminalOptions = {
      name: "catkin",
      pty: new CatkinToolsTerminal(pkg.workspace, ["build", pkg.name, ])
    };
    const terminal = vscode.window.createTerminal(opts);
    terminal.show();
    return new Promise<boolean>((resolve, reject) => {
      vscode.window.onDidCloseTerminal((t) => {
        if(terminal === t) {
          terminal.dispose();
          resolve(true);
        }
      });
    });
  }

  public setAutomaticTestMode() {
    this.test_mode_enabled = true;
    // logger.debug = function() {};
  }
}

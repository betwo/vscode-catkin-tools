import * as vscode from 'vscode';
import { IWorkspace } from 'vscode-catkin-tools-api';
import { CatkinToolsTerminal } from '../catkin_tools_terminal';
import { getExtensionConfiguration } from '../../common/configuration';

interface CatkinTaskDefinition extends vscode.TaskDefinition {
  /**
   * The task name
   */
  task: string;
}

const catkin_tools_build_script = 'catkin';

export async function getCatkinBuildTask(workspace: IWorkspace): Promise<vscode.Task[]> {
  const workspace_root_path = await workspace.getRootPath();
  const workspace_root = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(workspace_root_path.toString()));

  let result: vscode.Task[] = [];
  {
    let taskName = 'build';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, workspace_root, taskName,
      catkin_tools_build_script, new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
        return new CatkinToolsTerminal(workspace, ['build']);
      }));
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }
  {
    let taskName = 'build_tests';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, workspace_root, taskName,
      catkin_tools_build_script, new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
        return new CatkinToolsTerminal(workspace, ['build', '--make-args', 'tests']);
      }));
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }
  {
    let taskName = 'clean';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, workspace_root, taskName,
      catkin_tools_build_script, new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
        return new CatkinToolsTerminal(workspace, ['clean', '-y', '-v']);
      }));
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }
  {
    let taskName = 'build current package';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, workspace_root, taskName,
      catkin_tools_build_script, new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
        return new CatkinToolsTerminal(workspace, ['build', '--this', '-v', '--no-deps'], true);
      }));
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }
  {
    let taskName = 'build current package with dependencies';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, workspace_root, taskName,
      catkin_tools_build_script, new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
        return new CatkinToolsTerminal(workspace, ['build', '--this'], true);
      }));
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }
  {
    let taskName = 'build with custom parameters';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let getCatkinBuildArgs = () => {
      return getExtensionConfiguration<string[]>('catkinCustomBuildFlags');
    };
    let task = new vscode.Task(
      kind, workspace_root, taskName,
      catkin_tools_build_script, new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
        return new CatkinToolsTerminal(workspace, ['build'].concat(getCatkinBuildArgs()), true);
      }));
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }
  {
    let taskName = 'run current package tests';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, workspace_root, taskName,
      catkin_tools_build_script, new vscode.CustomExecution(async (resolvedDefinition: vscode.TaskDefinition): Promise<vscode.Pseudoterminal> => {
        return new CatkinToolsTerminal(workspace,
          ['test', '--this'],
          true, [['CTEST_OUTPUT_ON_FAILURE', '1']]);
      }));
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }
  return result;
}
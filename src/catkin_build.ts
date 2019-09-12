import * as vscode from 'vscode';

interface CatkinTaskDefinition extends vscode.TaskDefinition {
  /**
   * The task name
   */
  task: string;
}


export async function getCatkinBuildTask(): Promise<vscode.Task[]> {
  let workspaceRoot = vscode.workspace.rootPath;
  let emptyTasks: vscode.Task[] = [];
  if (!workspaceRoot) {
    return emptyTasks;
  }

  // command to find the directory containing '.catkin_tools'
  let find_basedir = 'basedir=$(pwd) && while ! [[ -d "${basedir}/.catkin_tools" ]] && [[ "${basedir}" != "/" ]]; do basedir=$(dirname $basedir); done';
  // command to push the current directory without printing
  let push_current_dir = 'pushd . > /dev/null';
  // command to pop a directory without printing
  let pop_dir = 'popd > /dev/null';

  // command to source the setup shell file for the enveloping workspace of the current directory
  //  1. find the base dir. If it can be found, change into it
  //  2.1 call `catkin locate -d` to find the current devel space, which is not guaranteed to be "devel"
  //  2.2. source the setup shell file ending with the current shell's name
  //  3. reset the working directory to the original
  let source_catkin = find_basedir + ' && ' + push_current_dir + ' && '
    + 'if [[ "${basedir}" != "/" ]]; then cd ${basedir}; fi' + ' && '
    + 'source "$(catkin locate -d)/setup.$(echo ${SHELL} | xargs basename)"' + ' && '
    + pop_dir;

  // command to source the setup shell file for the enveloping workspace of the workspace folder
  let source_workspace = 'cd "${workspaceFolder}" && ' + source_catkin;
  // command to source the setup shell file for the enveloping workspace of the folder ${fileDirname}
  let source_current_package = 'cd "${fileDirname}" && ' + source_catkin;

  let result: vscode.Task[] = [];
  {
    let taskName = 'build';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, taskName, 'catkin_build',
      new vscode.ShellExecution(source_workspace + ' && catkin build'),
      ['$catkin-gcc', '$catkin-cmake']);
    result.push(task);
  }
  {
    let taskName = 'build current package';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, taskName, 'catkin_build',
      new vscode.ShellExecution(source_current_package + ' && catkin build --this -v --no-deps'),
      ['$catkin-gcc', '$catkin-cmake']);
    result.push(task);
  }
  {
    let taskName = 'run current package tests';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, taskName, 'catkin_build',
      new vscode.ShellExecution(source_current_package + ' && ' +
        'env CTEST_OUTPUT_ON_FAILURE=1 catkin build --this -v --no-deps --catkin-make-args run_tests'),
      ['$catkin-gcc', '$catkin-cmake', '$catkin-gtest', '$catkin-gtest-failed']);
    result.push(task);
  }
  return result;
}
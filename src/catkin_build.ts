import * as vscode from 'vscode';

interface CatkinTaskDefinition extends vscode.TaskDefinition {
  /**
   * The task name
   */
  task: string;
}


export async function getCatkinBuildTask(workspace_root: vscode.WorkspaceFolder): Promise<vscode.Task[]> {
  // command to find the directory containing '.catkin_tools'
  let find_basedir = 'basedir=$(pwd) && while ! [[ -d "${basedir}/.catkin_tools" ]] && [[ "${basedir}" != "/" ]]; do basedir=$(dirname $basedir); done';
  // command to push the current directory without printing
  let push_current_dir = 'pushd . > /dev/null';
  // command to pop a directory without printing
  let pop_dir = 'popd > /dev/null';

  let find_source_script = 'export SOURCE_SCRIPT="${DEVEL_PREFIX}/setup.$(echo ${SHELL} | xargs basename)"'
    + ' && '
    + 'if [[ ! -f "${SOURCE_SCRIPT}" ]]; then export SOURCE_SCRIPT=$(catkin config | grep Extending | cut -c 30-)/setup.bash; fi';

  // command to source the setup shell file for the enveloping workspace of the current directory
  //  1. find the base dir. If it can be found, change into it
  //  2.1 call `catkin locate -d` to find the current devel space, which is not guaranteed to be "devel"
  //  2.2. source the setup shell file ending with the current shell's name
  //  3. reset the working directory to the original
  let source_catkin = find_basedir + ' && ' + push_current_dir + ' && '
    + 'if [[ "${basedir}" != "/" ]]; then cd ${basedir}; fi' + ' && '
    + 'export DEVEL_PREFIX=$(catkin locate -d) && '
    + find_source_script + ' && '
    + 'source "${SOURCE_SCRIPT}"' + ' && '
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
      kind, workspace_root, taskName, 'catkin_build',
      new vscode.ShellExecution(source_workspace + ' && catkin build'),
      ['$catkin-gcc', '$catkin-cmake']);
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }
  {
    let taskName = 'build current package';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, workspace_root, taskName, 'catkin_build',
      new vscode.ShellExecution(source_current_package + ' && catkin build --this -v --no-deps'),
      ['$catkin-gcc', '$catkin-cmake']);
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }
  {
    let taskName = 'run current package tests';
    let kind: CatkinTaskDefinition = { type: 'catkin_build', task: taskName };
    let task = new vscode.Task(
      kind, workspace_root, taskName, 'catkin_build',
      new vscode.ShellExecution(source_current_package + ' && ' +
        'env CTEST_OUTPUT_ON_FAILURE=1 catkin build --this -v --no-deps --catkin-make-args run_tests'),
      ['$catkin-gcc', '$catkin-cmake', '$catkin-gtest', '$catkin-gtest-failed']);
    task.group = vscode.TaskGroup.Build;
    result.push(task);
  }
  return result;
}
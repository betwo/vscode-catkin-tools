
import * as path from 'path';
import * as fs from 'fs';

import { IBuildTarget, TestType } from "vscode-catkin-tools-api";
import { runCommand } from "../shell_command";
import { logger } from '../logging';


export async function getCTestTargets(build_dir: fs.PathLike, name: String, query_for_cases: boolean): Promise<IBuildTarget[]> {
    let build_space = `${build_dir}/${name}`;

    // discover build targets:
    // ctest -N
    //  ->
    // _ctest_csapex_math_tests_gtest_csapex_math_tests
    //                                `---------------`

    // find gtest build targets
    let test_build_targets: IBuildTarget[] = [];
    if (query_for_cases) {
        try {
            let output = await runCommand('ctest', ['-N', '-V'], [], build_space);
            let current_executable: string = undefined;
            let current_test_type: TestType = undefined;
            let missing_exe = undefined;
            for (let line of output.stdout.split('\n')) {

                let test_command = line.match(/[0-9]+: Test command:\s+(.*)$/);
                if (test_command !== null) {
                    if (line.indexOf('catkin_generated') > 0) {
                        const catkin_test_wrapper = line.match(/[0-9]+: Test command:\s+.*env_cached.sh\s*.*"([^"]+\s+--gtest_output=[^"]+)".*/);
                        const rostest_wrapper = line.match(/[0-9]+: Test command:\s+(.*env_cached.sh.*cmake\/test\/run_tests.py.*bin\/rostest.*)/);
                        if (catkin_test_wrapper !== null) {
                            current_executable = catkin_test_wrapper[1];
                            current_test_type = 'gtest';
                        } else if (rostest_wrapper !== null) {
                            current_executable = rostest_wrapper[1];
                            current_test_type = 'generic';
                        } else {
                            current_executable = test_command[1];
                            current_test_type = 'unknown';
                        }
                    } else if (line.indexOf('ament_cmake_test') > 0) {
                        let ament_gtest_wrapper = line.match(/[0-9]+: Test command:.*"--command"\s+"([^"]+)"\s+"(--gtest_output=[^"]+)".*/);
                        if (ament_gtest_wrapper !== null) {
                            current_executable = ament_gtest_wrapper[1];
                            current_test_type = 'gtest';
                        } else {
                            let ament_xunit_test_wrapper = line.match(/[0-9]+: Test command:.*"--command"\s+"([^"]+)"\s+"--xunit-file"\s+"([^"]+)".*/);
                            if (ament_xunit_test_wrapper !== null) {
                                current_executable = ament_xunit_test_wrapper[1];
                                current_test_type = 'gtest';
                            } else {
                                current_executable = test_command[1];
                                current_test_type = 'unknown';
                            }
                        }
                    } else {
                        let gtest_output = line.match(/[0-9]+: Test command:\s+"([^"]+\s+--gtest_output=[^"]+)".*/);
                        if (gtest_output !== null) {
                            current_executable = gtest_output[1];
                            current_test_type = 'gtest';
                        } else {
                            current_executable = test_command[1];
                            current_test_type = 'unknown';
                        }
                    }
                    continue;
                }
                // GTest target test
                let gtest_match = line.match(/ Test\s+#.*gtest_(.*)/);
                if (gtest_match) {
                    if (current_executable === undefined) {
                        continue;
                    }
                    let target: IBuildTarget = {
                        cmake_target: gtest_match[1],
                        label: gtest_match[1],
                        exec_path: current_executable,
                        type: current_test_type
                    };
                    test_build_targets.push(target);
                } else {
                    if (line.indexOf('catkin_generated') > 0) {
                        continue;
                    } else if (line.indexOf('ament_cmake_test') > 0) {
                        continue;
                    }
                    // general CTest target test
                    let missing_exec_match = line.match(/Could not find executable\s+([^\s]+)/);
                    if (missing_exec_match) {
                        missing_exe = missing_exec_match[1];
                    } else {
                        let ctest_match = line.match(/\s+Test\s+#[0-9]+:\s+([^\s]+)/);
                        if (ctest_match) {
                            if (current_executable === undefined) {
                                continue;
                            }
                            let target = ctest_match[1];
                            if (target.length > 1 && target !== 'cmake') {
                                let cmd = current_executable;
                                if (missing_exe !== undefined) {
                                    cmd = missing_exe + " " + cmd;
                                }

                                // determine executable
                                // trip quotes
                                let stripped_exe = current_executable.replace(/"/g, "");
                                // strip --gtest_output if present
                                stripped_exe = stripped_exe.replace(/--gtest_output\S+/g, "");
                                // then take the first argument when splitting with whitespace
                                let exe = path.basename(stripped_exe.split(/\s/)[0]);
                                if (exe.length === 0) {
                                    // assume that the executable has the same name as the cmake target
                                    exe = target;
                                }
                                let label = exe;
                                if (cmd.indexOf('bin/rostest') > 0) {
                                    const rostest_wrapper = cmd.match(/.*"\s*[^\s]+\/test_([^\s]+)\.test["\s]*/);
                                    if (rostest_wrapper !== null) {
                                        label = rostest_wrapper[1];
                                        exe = rostest_wrapper[1];
                                    } else {
                                        label = target;
                                    }
                                }
                                test_build_targets.push({
                                    cmake_target: exe,
                                    label: label,
                                    exec_path: cmd,
                                    type: current_test_type
                                });
                            }
                            missing_exe = undefined;
                        }
                    }
                }
            }

        } catch (err) {
            logger.error(`Cannot call ctest:`, err);
            throw err;
        }
    }

    return test_build_targets;
}

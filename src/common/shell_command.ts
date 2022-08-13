import * as child_process from 'child_process';
import { assert } from 'console';
import * as fs from 'fs';
import { getExtensionConfiguration } from './configuration';
import { logger } from './logging';

export class ShellOutput {
    constructor(
        public stdout: string,
        public stderr: string,
        public command: string,
        public error?: Error
    ) {
    }
}

export function getShell(): string {
    return getExtensionConfiguration('shell');
}

export function getShellExtension(): string {
    return getExtensionConfiguration('shell');
}

export function getShellArgs(shell: string): string[] {
    return (shell === 'bash' || shell === 'sh') ? ["--norc"] : [];
}

export function runShellCommand(
    command: string,
    environment: [string, string][],
    cwd: fs.PathLike,
    callback?: (process: child_process.ChildProcess) => any,
    out?: (lines: string) => void,
    error?: (lines: string) => void
): Thenable<ShellOutput> {
    let options: child_process.ExecOptions = {
        cwd: cwd.toString(),
        maxBuffer: 1024 * 1024
    };
    const shell = getShell();
    const shell_args = getShellArgs(shell).concat(["-c", command]);

    const additional_env_vars: [string, string][] = [];

    return runCommand(shell, shell_args, environment, cwd, additional_env_vars, callback, out, error);
}

export function runCommand(
    command: string,
    args: string[],
    environment: [string, string][],
    cwd: fs.PathLike,
    additional_env_vars?: [string, string][],
    callback?: (process: child_process.ChildProcess) => any,
    out?: (lines: string) => void,
    error?: (lines: string) => void
): Thenable<ShellOutput> {
    return new Promise<ShellOutput>((resolve, reject) => {
        let full_command = `${command} ${args.join(" ")}`;

        if (cwd === undefined) {
            let result = new ShellOutput("", "", full_command);
            logger.error("Cannot run command, cwd is undefined");
            result.error = new Error("Cannot run command, cwd is undefined");

            reject(result);
        }

        if (!fs.existsSync(cwd.toString())) {
            let result = new ShellOutput("", "", full_command);
            logger.error(`Invalid working directory, working directory ${cwd} does not exist`);
            result.error = new Error(`Invalid working directory, working directory ${cwd} does not exist`);
            reject(result);
        }

        let environment_kv = {};
        if (environment.length !== 0) {
            for (const v of environment) {
                environment_kv[v[0]] = v[1];
            }
        } else {
            for (const key in process.env) {
                environment_kv[key] = process.env[key];
            }
        }
        if (additional_env_vars !== undefined) {
            for (const v of additional_env_vars) {
                environment_kv[v[0]] = v[1];
            }
        }

        let options: child_process.SpawnOptions = {
            cwd: cwd.toString(),
            detached: false,
            shell: false,
            killSignal: "SIGTERM",
            env: environment_kv
        };
        logger.debug(`Running async command ${full_command}`);
        try {
            let pid = child_process.spawn(command, args, options);
            let stdout = "";
            let stderr = "";
            logger.debug(`Spawned async full command ${full_command} with pid ${pid.pid} in directory ${cwd.toString()}`);
            pid.stdout.on('data', (data) => {
                stdout += data;
                if (out !== undefined) {
                    out(data.toString());
                }
            });
            pid.stderr.on('data', (data) => {
                stderr += data;
                if (error !== undefined) {
                    error(data.toString());
                }
            });
            pid.on('error', (error) => {
                logger.error(error);
                if (environment.length === 0) {
                    logger.error(`Command ${full_command} cannot be executed with process environment in ${cwd}`);
                    for (const key in environment_kv) {
                        logger.error(`- ${key}: ${environment_kv[key]}`);
                    }
                    logger.error();
                } else {
                    logger.error(`Command ${full_command} cannot be executed with custom environment in ${cwd}`);
                }

                const result = new ShellOutput("", "", full_command);
                result.error = error;
                reject(result);
            });

            let exit_code = undefined;
            let signal_code = undefined;
            let result: ShellOutput = undefined;
            let maybe_finalize = () => {
                if ((exit_code === undefined && signal_code === undefined) || result === undefined) {
                    // either exit or close has not yet been called
                    return;
                }
                if (exit_code !== undefined) {
                    if (exit_code !== 0) {
                        reject(result);
                    } else {
                        resolve(result);
                    }
                } else {
                    assert(signal_code !== undefined);
                    result.error = new Error(`Killed by signal ${signal_code}`);
                    reject(result);
                }

            };

            pid.on('exit', (code) => {
                if (code === null) {
                    // killed by a signal
                    logger.silly(`child process ${full_command} (pid  ${pid.pid}) killed with signal ${pid.signalCode}`);
                    signal_code = pid.signalCode;
                } else {
                    exit_code = code;
                    logger.silly(`child process ${full_command} (pid  ${pid.pid}) exited with exit code ${code}`);
                }
                maybe_finalize();
            });
            pid.on('close', () => {
                logger.debug(`child process ${full_command} (pid  ${pid.pid}) closed`);
                result = new ShellOutput(stdout, stderr, full_command);
                maybe_finalize();
            });
            if (callback) {
                callback(pid);
            }
        } catch (error) {
            logger.error(`child process ${full_command} failed with ${error}`);
            const result = new ShellOutput("", "", full_command);
            result.error = error;
            logger.error(error);
            reject(result);
        }
    });
}
import * as fs from 'fs';
import * as child_process from 'child_process';

import { runCommand, ShellOutput } from '../common/shell_command';
import { logger } from '../common/logging';

export async function runCatkinCommand(
    args: string[],
    cwd: fs.PathLike,
    retries?: number,
    additional_env_vars?: [string, string][],
    callback?: (process: child_process.ChildProcess) => any,
    out?: (lines: string) => void,
    error?: (lines: string) => void
): Promise<ShellOutput> {
    try {
        if (args[0] === "build" || args[0] === "test") {
            if (args.indexOf('--force-color') < 0) {
                args.splice(1, 0, '--force-color');
            }
            if (args.indexOf('--no-notify') < 0) {
                args.splice(1, 0, '--no-notify');
            }
        }
        return await runCommand("catkin", args, [], cwd, additional_env_vars, callback, out, error);
    } catch (error) {
        logger.error(error);
        if (retries !== undefined && retries > 0) {
            return await runCatkinCommand(args, cwd, retries - 1, additional_env_vars, callback, out, error);
        }
        throw error;
    }
}
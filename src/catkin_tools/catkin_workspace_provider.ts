import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'fast-glob';

import { WorkspaceProvider } from "vscode-catkin-tools-api";
import { runCatkinCommand } from "./catkin_command";
import { ShellOutput } from '../common/shell_command';
import { setProfileText } from '../common/status_bar';

export class CatkinWorkspaceProvider implements WorkspaceProvider {
    private catkin_config = new Map<string, string>();

    private workspace_src_dir: string = null;
    private workspace_build_dir: string = null;
    private workspace_install_dir: string = null;
    private catkin_profile: string = null;
    private catkin_devel_dir: string = null;

    constructor(
        public associated_workspace_for_tasks: vscode.WorkspaceFolder,
    ) { }

    getWorkspaceType(): string {
        return "catkin_tools";
    }

    getRootPath(): Promise<fs.PathLike> {
        return this.getConfigEntry('Workspace');
    }

    async getSrcDir(): Promise<string> {
        await this.checkProfile();
        if (this.workspace_src_dir === null) {
            const output: ShellOutput = await runCatkinCommand(['locate', '-s'], await this.getRootPath());
            this.workspace_src_dir = output.stdout.split('\n')[0];
        }
        return this.workspace_src_dir;
    }
    async getBuildDir(): Promise<string> {
        await this.checkProfile();
        if (this.workspace_build_dir === null) {
            const output: ShellOutput = await runCatkinCommand(['locate', '-b'], await this.getRootPath());
            this.workspace_build_dir = output.stdout.split('\n')[0];
            if (this.workspace_build_dir.endsWith("/")) {
                this.workspace_build_dir = this.workspace_build_dir.slice(0, -1);
            }
        }
        return this.workspace_build_dir;
    }
    async getDevelDir(): Promise<string> {
        await this.checkProfile();
        if (this.catkin_devel_dir === null) {
            const output: ShellOutput = await runCatkinCommand(['locate', '-d'], await this.getRootPath());
            this.catkin_devel_dir = output.stdout.split('\n')[0];
            if (this.catkin_devel_dir.endsWith("/")) {
                this.catkin_devel_dir = this.catkin_devel_dir.slice(0, -1);
            }
        }
        return this.catkin_devel_dir;
    }
    async getInstallDir(): Promise<string> {
        await this.checkProfile();
        if (this.workspace_install_dir === null) {
            const output: ShellOutput = await runCatkinCommand(['locate', '-i'], await this.getRootPath());
            this.workspace_install_dir = output.stdout.split('\n')[0];
            if (this.workspace_install_dir.endsWith("/")) {
                this.workspace_install_dir = this.workspace_install_dir.slice(0, -1);
            }
        }
        return this.workspace_install_dir;
    }

    reload() {
        this.loadCatkinConfig();
    }

    getCodeWorkspace(): vscode.WorkspaceFolder {
        return this.associated_workspace_for_tasks;
    }

    getCmakeArguments() {
        return this.getConfigEntry("Additional CMake Args");
    }

    async getBuildTask(): Promise<vscode.Task> {
        let build_tasks = await vscode.tasks.fetchTasks({
            type: "catkin_build"
        });
        if (build_tasks !== undefined && build_tasks.length > 0) {
            for (let task of build_tasks) {
                if (task.name === "build" && task.scope === this.associated_workspace_for_tasks) {
                    return task;
                }
            }
        }
        return undefined;
    }

    getDefaultRunTestTarget(): string {
        return 'run_tests';
    }

    makePackageBuildCommand(package_name: string): string {
        return `catkin build ${package_name} --no-notify --no-status`;
    }

    makeRosSourcecommand(): string {
        // determine latest ros2 version
        let find_ros1_version = 'for ROS1_VERSION in $(ls /opt/ros/|sort -r); do CATKIN_LINES=$(cat /opt/ros/$ROS1_VERSION/setup.sh | grep CATKIN | wc -l); if [ $CATKIN_LINES != "0" ]; then export INSTALL_PREFIX=/opt/ros/$ROS1_VERSION/; break; fi; done';
        let source_script = find_ros1_version + '; source ${INSTALL_PREFIX}/setup.$(echo ${SHELL} | xargs basename)';
        return source_script;
    }

    async enableCompileCommandsGeneration() {
        const cmake_opts = await this.getConfigEntry("Additional CMake Args");
        runCatkinCommand(['config', '--cmake-args', `${cmake_opts !== "None" ? `${cmake_opts} ` : ""}-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`], await this.getRootPath());
        this.loadCatkinConfig();
    }

    public async checkProfile() {
        let profile = await this.getActiveProfile();
        if (this.catkin_profile !== profile) {
            await this.updateProfile(profile);
        }
    }

    public async getProfiles(): Promise<string[]> {
        const root_path = await this.getRootPath();
        let profile_base_path = path.join(root_path.toString(), ".catkin_tools/profiles");
        if (!fs.existsSync(profile_base_path)) {
            console.error(".catkin_tools was not found, cannot enumerate profiles");
            return [];
        }

        const configs = await glob.async([profile_base_path + '/**/config.yaml']);
        return configs.map((yaml) => path.basename(path.dirname(yaml.toString())));
    }

    public async getActiveProfile(): Promise<string> {
        const root_path = await this.getRootPath();
        let profile_base_path = path.join(root_path.toString(), ".catkin_tools/profiles");

        let profiles_path = path.join(profile_base_path, "profiles.yaml");
        if (!fs.existsSync(profiles_path)) {
            // profiles.yaml is only generated when there is more than one profile available
            // if it does not exist, then the `default` profile is used
            return 'default';
        }

        const content_raw = await fs.promises.readFile(profiles_path);
        const content = content_raw.toString();
        for (let row of content.split('\n')) {
            let active = row.match(RegExp('active:\s*(.*)'));
            if (active) {
                return active[1].trim();
            }
        }
        return null;
    }

    private async updateProfile(profile) {
        console.log(`PROFILE: Switching to ${profile}`);
        this.catkin_profile = profile;
        this.workspace_src_dir = null;
        this.workspace_build_dir = null;
        this.catkin_devel_dir = null;
        this.workspace_install_dir = null;

        setProfileText(profile);

        await this.reload();
    }


    public async switchProfile(profile) {
        const root_path = await this.getRootPath();
        runCatkinCommand(['profile', 'set', profile], root_path);
        await this.checkProfile();
        return true;
    }



    private async loadCatkinConfig() {
        const output = await runCatkinCommand(['config'], this.associated_workspace_for_tasks.uri.fsPath);

        this.catkin_config.clear();
        for (const line of output.stdout.split("\n")) {
            if (line.indexOf(":") > 0) {
                const [key, val] = line.split(":").map(s => s.trim());
                console.log(key, val);
                this.catkin_config.set(key, val);
            }
        }
    }

    private async getConfigEntry(key: string): Promise<string> {
        if (this.catkin_config.size === 0) {
            await this.loadCatkinConfig();
        }
        return this.catkin_config.get(key);
    }

}
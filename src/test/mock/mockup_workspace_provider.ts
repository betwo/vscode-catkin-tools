import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { WorkspaceProvider } from "vscode-catkin-tools-api";

export class MockupWorkspaceProvider implements WorkspaceProvider {
    private catkin_config = new Map<string, string>();

    private workspace_src_dir: string = null;
    private workspace_build_dir: string = null;
    private workspace_install_dir: string = null;

    constructor() { }

    getWorkspaceType(): string {
        return "mockup";
    }

    async getRootPath(): Promise<fs.PathLike> {
        return "/tmp";
    }

    async getSrcDir(): Promise<string> {
        await this.checkProfile();
        if (this.workspace_src_dir === null) {
            this.workspace_src_dir = "/tmp" + "/src";
        }
        return this.workspace_src_dir;
    }
    async getBuildDir(): Promise<string> {
        await this.checkProfile();
        if (this.workspace_build_dir === null) {
            this.workspace_build_dir = "/tmp" + "/build";
        }
        return this.workspace_build_dir;
    }
    async getDevelDir(): Promise<string> {
        return undefined;
    }
    async getInstallDir(): Promise<string> {
        await this.checkProfile();
        if (this.workspace_install_dir === null) {
            this.workspace_install_dir = "/tmp" + "/install";
        }
        return this.workspace_install_dir;
    }
    async getDefaultRosWorkspace(): Promise<string> {
        throw Error("Cannot determine default ros workspace");
    }

    reload(): Promise<void> {
        return this.loadmockupConfig();
    }

    getCodeWorkspace(): vscode.WorkspaceFolder {
        throw Error("Cannot determine code workspace");
    }

    async getCmakeArguments() {
        return undefined;
    }

    async getBuildTask(): Promise<vscode.Task> {
        throw Error("Cannot determine build task");
    }

    async getBuildTestsTask(): Promise<vscode.Task> {
        throw Error("Cannot determine build test task");
    }

    async getCleanTask(): Promise<vscode.Task> {
        throw Error("Cannot determine clean task");
    }

    getDefaultRunTestTargetName(): string {
        return 'test';
    }

    makePackageBuildCommand(package_name: string): string {
        return `mockup build --packages-up-to ${package_name}`;
    }

    makeRosSourcecommand(): string {
        // determine latest ros2 version
        let find_ros2_version = 'for ROS2_VERSION in $(ls /opt/ros/|sort -r); do AMENT_LINES=$(cat /opt/ros/$ROS2_VERSION/setup.sh | grep ament | wc -l); if [ $AMENT_LINES != "0" ]; then export INSTALL_PREFIX=/opt/ros/$ROS2_VERSION/; break; fi; done';
        let source_script = `if [ -d "/opt/ros/" ]; then ${find_ros2_version}; source \${INSTALL_PREFIX}/setup.$(echo \${SHELL} | xargs basename); fi`;
        return source_script;
    }

    async enableCompileCommandsGeneration() : Promise<boolean> {
        return true;
    }

    async initialize(extending: fs.PathLike[]): Promise<boolean> {
        return true;
    }
    async isInitialized(): Promise<boolean> {
        return true;
    }

    public async checkProfile() {
    }

    public async getProfiles(): Promise<string[]> {
        return [];
    }

    public async getActiveProfile(): Promise<string> {
        return null;
    }

    public async switchProfile(profile) {
        return false;
    }

    private async loadmockupConfig() {
    }

    private async getConfigEntry(key: string): Promise<string> {
        return undefined;
    }

}
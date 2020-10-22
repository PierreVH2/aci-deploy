"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskParameters = void 0;
const core = __importStar(require("@actions/core"));
const yaml_1 = require("yaml");
class TaskParameters {
    constructor(endpoint) {
        this._subscriptionId = endpoint.subscriptionID;
        this._groupName = core.getInput('group-name', { required: true });
        this._resourceGroup = core.getInput('resource-group', { required: true });
        this._dnsNameLabel = core.getInput('dns-name-label');
        this._diagnostics = {};
        let logType = core.getInput('log-type');
        let logAnalyticsWorkspace = core.getInput('log-analytics-workspace');
        let logAnalyticsWorkspaceKey = core.getInput('log-analytics-workspace-key');
        this._getDiagnostics(logAnalyticsWorkspace, logAnalyticsWorkspaceKey, logType);
        const networkProfileId = core.getInput('network-profile');
        const ipAddress = core.getInput('ip-address');
        if (ipAddress && ["Public", "Private"].indexOf(ipAddress) < 0) {
            throw Error('The Value of IP Address must be either Public or Private');
        }
        else {
            if (ipAddress == 'Private') {
                if (!networkProfileId) {
                    throw Error('A network profile must be specified if the IP address is set to Private');
                }
                if (!!this._dnsNameLabel) {
                    throw Error('A DNS label may not be specified if the IP address is set to Public');
                }
                this._ipAddress = 'Private';
                this._networkProfile = {
                    id: networkProfileId
                };
            }
            else {
                if (!!networkProfileId) {
                    throw Error('A network profile may not be specified if the IP address is set to Public');
                }
                this._ipAddress = 'Public';
            }
        }
        this._location = core.getInput('location', { required: true });
        let osType = core.getInput('os-type');
        if (osType && ['Linux', 'Windows'].indexOf(osType) < 0) {
            throw Error('The Value of OS Type must be either Linux or Windows only!');
        }
        else {
            this._osType = (osType == 'Linux') ? 'Linux' : 'Windows';
        }
        this._registryLoginServer = core.getInput('registry-login-server');
        if (!this._registryLoginServer) {
            // If the user doesn't give registry login server and the registry is ACR
            let imageList = this._registryLoginServer.split('/');
            if (imageList[0].indexOf('azurecr') > -1) {
                this._registryLoginServer = imageList[0];
            }
        }
        this._registryUsername = core.getInput('registry-username');
        this._registryPassword = core.getInput('registry-password');
        let restartPolicy = core.getInput('restart-policy');
        if (restartPolicy && ["Always", "OnFailure", "Never"].indexOf(restartPolicy) < 0) {
            throw Error('The Value of Restart Policy can be "Always", "OnFailure" or "Never" only!');
        }
        else {
            this._restartPolicy = (restartPolicy == 'Always') ? 'Always' : (restartPolicy == 'Never' ? 'Never' : 'OnFailure');
        }
        this._volumes = [];
        this._getSecretVolume();
        this._getGitVolume();
        this._getAzureFileShareVolume();
        this._getEmptyFileVolue();
        this._containers = this._getContainers(core.getInput('containers'));
    }
    _getContainers(containersStr) {
        const containersObj = yaml_1.parse(containersStr);
        if (!containersObj || !Array.isArray(containersObj)) {
            throw Error("Containers field must be a list");
        }
        return containersObj.map(item => {
            if (!item['name'] || typeof item['name'] !== 'string') {
                throw new Error('Container name may not be empty');
            }
            if (!item['image'] || typeof item['image'] !== 'string') {
                throw new Error('Container image may not be empty');
            }
            let cpu = parseFloat(item['cpu']);
            if (cpu <= 0) {
                cpu = 1;
            }
            let memory = parseFloat(item['memory']);
            if (memory <= 0) {
                memory = 1.5;
            }
            const container = {
                name: item['name'],
                image: item['image'],
                resources: {
                    requests: {
                        memoryInGB: memory,
                        cpu: cpu
                    }
                },
            };
            if (!!item['command'] && typeof item['command'] === 'string') {
                container.command = item['command'].split(' ');
            }
            if (!!item['ports'] && typeof (item['ports'] === 'string')) {
                container.ports = this._getPorts(item['ports']);
            }
            const envVars = !!item['environmentVariables'] && typeof item['environmentVariables'] === 'string' ? item['environmentVariables'] : '';
            const secureEnvVars = !!item['secureEnvironmentVariables'] && typeof item['secureEnvironmentVariables'] === 'string'
                ? item['secureEnvironmentVariables']
                : '';
            const variables = this._getEnvironmentVariables(envVars, secureEnvVars);
            if (variables.length > 0) {
                container.environmentVariables = variables;
            }
            const mounts = [];
            if (!!item['azureFileVolumeMountPath'] && typeof item['azureFileVolumeMountPath'] === 'string') {
                mounts.push({
                    name: "azure-file-share-vol",
                    mountPath: item['azureFileVolumeMountPath']
                });
            }
            if (!!item['gitrepoMountPath'] && typeof item['gitrepoMountPath'] === 'string') {
                mounts.push({
                    name: "git-repo-vol",
                    mountPath: item['gitrepoMountPath']
                });
            }
            if (!!item['secretsMountPath'] && typeof item['secretsMountPath'] === 'string') {
                mounts.push({
                    name: "secrets-vol",
                    mountPath: item['secretsMountPath']
                });
            }
            if (!!item['emptyMountPath'] && typeof item['emptyMountPath'] === 'string') {
                mounts.push({
                    name: 'empty-vol',
                    mountPath: item['emptyMountPath']
                });
            }
            container.volumeMounts = mounts;
            return container;
        });
    }
    _getDiagnostics(logAnalyticsWorkspace, logAnalyticsWorkspaceKey, logType) {
        if (logAnalyticsWorkspace || logAnalyticsWorkspaceKey) {
            if (!logAnalyticsWorkspaceKey || !logAnalyticsWorkspace) {
                throw Error("The Log Analytics Workspace Id or Workspace Key are not provided. Please fill in the appropriate parameters.");
            }
            if (logType && ['ContainerInsights', 'ContainerInstanceLogs'].indexOf(logType) < 0) {
                throw Error("Log Type Can be Only of Type `ContainerInsights` or `ContainerInstanceLogs`");
            }
            let logAnalytics = { "workspaceId": logAnalyticsWorkspace,
                "workspaceKey": logAnalyticsWorkspaceKey };
            if (logType) {
                let logT;
                logT = (logType == 'ContainerInsights') ? 'ContainerInsights' : 'ContainerInstanceLogs';
                logAnalytics.logType = logT;
            }
            this._diagnostics = { "logAnalytics": logAnalytics };
        }
    }
    _getEnvironmentVariables(environmentVariables, secureEnvironmentVariables) {
        const variables = [];
        if (environmentVariables) {
            // split on whitespace, but ignore the ones that are enclosed in quotes
            let keyValuePairs = environmentVariables.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
            keyValuePairs.forEach((pair) => {
                // value is either wrapped in quotes or not
                let pairList = pair.split(/=(?:"(.+)"|(.+))/);
                let obj = {
                    name: pairList[0],
                    value: pairList[1] || pairList[2]
                };
                variables.push(obj);
            });
        }
        if (secureEnvironmentVariables) {
            // split on whitespace, but ignore the ones that are enclosed in quotes
            let keyValuePairs = secureEnvironmentVariables.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
            keyValuePairs.forEach((pair) => {
                // value is either wrapped in quotes or not
                let pairList = pair.split(/=(?:"(.+)"|(.+))/);
                let obj = {
                    name: pairList[0],
                    secureValue: pairList[1] || pairList[2]
                };
                variables.push(obj);
            });
        }
        return variables;
    }
    _getPorts(ports) {
        return ports.split(' ').map((portStr) => TaskParameters.parsePort(portStr));
    }
    _getSecretVolume() {
        const secretsStr = core.getInput('secrets-volume');
        if (!secretsStr) {
            return;
        }
        const secretsMap = secretsStr.split(' ').reduce((accumulator, nextKeyVal) => {
            const keyval = nextKeyVal.split(/=(.+)/);
            accumulator[keyval[0].replace('_', '.')] = keyval[1] || '';
            return accumulator;
        }, {});
        this._volumes.push({ name: "secrets-vol", secret: secretsMap });
    }
    _getGitVolume() {
        const gitRepoVolumeUrl = core.getInput('gitrepo-url');
        if (!gitRepoVolumeUrl) {
            return;
        }
        const gitRepoDir = core.getInput('gitrepo-dir');
        const gitRepoRevision = core.getInput('gitrepo-revision');
        const vol = { "repository": gitRepoVolumeUrl };
        if (gitRepoDir) {
            vol.directory = gitRepoDir;
        }
        if (gitRepoRevision) {
            vol.revision = gitRepoRevision;
        }
        this._volumes.push({ name: "git-repo-vol", gitRepo: vol });
    }
    _getAzureFileShareVolume() {
        const afsAccountName = core.getInput('azure-file-volume-account-name');
        const afsShareName = core.getInput('azure-file-volume-share-name');
        if (!afsShareName && !afsAccountName) {
            return;
        }
        if (!afsShareName) {
            throw Error("The Name of the Azure File Share is required to mount it as a volume");
        }
        if (!afsAccountName) {
            throw Error("The Storage Account Name for the Azure File Share is required to mount it as a volume");
        }
        const afsAccountKey = core.getInput('azure-file-volume-account-key');
        const afsReadOnly = core.getInput('azure-file-volume-read-only');
        const vol = { "shareName": afsShareName, "storageAccountName": afsAccountName };
        if (afsAccountKey) {
            vol.storageAccountKey = afsAccountKey;
        }
        if (afsReadOnly) {
            if (["true", "false"].indexOf(afsReadOnly) < 0) {
                throw Error("The Read-Only Flag can only be `true` or `false` for the Azure File Share Volume");
            }
            vol.readOnly = (afsReadOnly == "true");
        }
        this._volumes.push({ name: "azure-file-share-vol", azureFile: vol });
    }
    _getEmptyFileVolue() {
        const emptyVolume = core.getInput('empty-volume') || "false";
        if (["true", "false"].indexOf(emptyVolume) < 0) {
            throw Error("The Empty-Volume Flag can only be `true` or `false`");
        }
        if (emptyVolume === "true") {
            this._volumes.push({ name: "empty-vol", emptyDir: {} });
        }
    }
    static parsePort(portStr) {
        if (portStr.indexOf(':') > 0) {
            const parts = portStr.split(':');
            return {
                port: parseInt(parts[0]),
                protocol: TaskParameters.parsePortProtocol(parts[1])
            };
        }
        return { port: parseInt(portStr) };
    }
    static parsePortProtocol(protoStr) {
        if (['UDP', 'TCP'].indexOf(protoStr) < 0) {
            throw new Error(`Invalid port protocol: ${protoStr}`);
        }
        return protoStr;
    }
    static getTaskParams(endpoint) {
        if (!this.taskparams) {
            this.taskparams = new TaskParameters(endpoint);
        }
        return this.taskparams;
    }
    get containers() {
        return this._containers;
    }
    get groupName() {
        return this._groupName;
    }
    get resourceGroup() {
        return this._resourceGroup;
    }
    get diagnostics() {
        return this._diagnostics;
    }
    get dnsNameLabel() {
        return this._dnsNameLabel;
    }
    get ipAddress() {
        return this._ipAddress;
    }
    get networkProfile() {
        return this._networkProfile;
    }
    get location() {
        return this._location;
    }
    get osType() {
        return this._osType;
    }
    get registryLoginServer() {
        return this._registryLoginServer;
    }
    get registryUsername() {
        return this._registryUsername;
    }
    get registryPassword() {
        return this._registryPassword;
    }
    get restartPolicy() {
        return this._restartPolicy;
    }
    get volumes() {
        return this._volumes;
    }
    get subscriptionId() {
        return this._subscriptionId;
    }
}
exports.TaskParameters = TaskParameters;

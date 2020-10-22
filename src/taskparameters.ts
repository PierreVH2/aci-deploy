import * as core from '@actions/core';
import { IAuthorizer } from "azure-actions-webclient/Authorizer/IAuthorizer";
import { ContainerInstanceManagementModels } from '@azure/arm-containerinstance';
import { parse as yamlParse } from 'yaml';
import { VolumeMount } from '@azure/arm-containerinstance/esm/models';

export class TaskParameters {
    private static taskparams: TaskParameters;
    private _groupName: string;
    private _resourceGroup: string;
    private _diagnostics: ContainerInstanceManagementModels.ContainerGroupDiagnostics;
    private _dnsNameLabel: string;
    private _ipAddress:ContainerInstanceManagementModels.ContainerGroupIpAddressType;
    private _location:string;
    private _osType: ContainerInstanceManagementModels.OperatingSystemTypes;
    private _registryLoginServer: string;
    private _registryUsername: string;
    private _registryPassword: string;
    private _restartPolicy: ContainerInstanceManagementModels.ContainerGroupRestartPolicy;
    private _volumes: Array<ContainerInstanceManagementModels.Volume>;
    private _networkProfile?: ContainerInstanceManagementModels.ContainerGroupNetworkProfile;
    private _containers: ContainerInstanceManagementModels.Container[];
    
    private _subscriptionId: string;

    private constructor(endpoint: IAuthorizer) {
        this._subscriptionId = endpoint.subscriptionID;
        this._groupName = core.getInput('group-name', { required: true });
        this._resourceGroup = core.getInput('resource-group', { required: true });
        this._dnsNameLabel = core.getInput('dns-name-label');
        this._diagnostics = {}
        let logType = core.getInput('log-type');
        let logAnalyticsWorkspace = core.getInput('log-analytics-workspace');
        let logAnalyticsWorkspaceKey = core.getInput('log-analytics-workspace-key');
        this._getDiagnostics(logAnalyticsWorkspace, logAnalyticsWorkspaceKey, logType);
        const networkProfileId = core.getInput('network-profile');
        const ipAddress = core.getInput('ip-address');
        if(ipAddress && ["Public", "Private"].indexOf(ipAddress) < 0) {
            throw Error('The Value of IP Address must be either Public or Private');
        } else {
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
                }
            } else {
                if (!!networkProfileId) {
                    throw Error('A network profile may not be specified if the IP address is set to Public');
                }
                this._ipAddress = 'Public';
            }
        }
        this._location = core.getInput('location', { required: true });
        let osType = core.getInput('os-type');
        if(osType && ['Linux', 'Windows'].indexOf(osType) < 0) {
            throw Error('The Value of OS Type must be either Linux or Windows only!')
        } else {
            this._osType = (osType == 'Linux') ? 'Linux' : 'Windows';
        }
        this._registryLoginServer = core.getInput('registry-login-server');
        if(!this._registryLoginServer) {
            // If the user doesn't give registry login server and the registry is ACR
            let imageList = this._registryLoginServer.split('/');
            if(imageList[0].indexOf('azurecr') > -1) {
                this._registryLoginServer = imageList[0];
            }
        }
        this._registryUsername = core.getInput('registry-username');
        this._registryPassword = core.getInput('registry-password');
        let restartPolicy = core.getInput('restart-policy');
        if(restartPolicy && ["Always", "OnFailure", "Never"].indexOf(restartPolicy) < 0) {
            throw Error('The Value of Restart Policy can be "Always", "OnFailure" or "Never" only!');
        } else {
            this._restartPolicy = ( restartPolicy == 'Always' ) ? 'Always' : ( restartPolicy == 'Never' ? 'Never' : 'OnFailure');
        }

        this._volumes = [];
        this._getSecretVolume();
        this._getGitVolume();
        this._getAzureFileShareVolume();
        this._getEmptyFileVolue();

        this._containers = this._getContainers(core.getInput('containers'));
    }

    private _getContainers(containersStr: string): ContainerInstanceManagementModels.Container[] {
        const containersObj = yamlParse(containersStr);
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
            } as ContainerInstanceManagementModels.Container;

            if (!!item['command'] && typeof item['command'] === 'string') {
                container.command = item['command'].split(' ');
            }

            if (!!item['ports'] && typeof(item['ports'] === 'string')) {
                container.ports = this._getPorts(item['ports']);
            }

            const envVars = !!item['environmentVariables'] && typeof item['environmentVariables'] === 'string' ? item['environmentVariables'] : '';
            const secureEnvVars = 
                !!item['secureEnvironmentVariables'] && typeof item['secureEnvironmentVariables'] === 'string' 
                ? item['secureEnvironmentVariables'] 
                : '';
            const variables = this._getEnvironmentVariables(envVars, secureEnvVars);
            if (variables.length > 0) {
                container.environmentVariables = variables;
            }

            const mounts: VolumeMount[] = [];
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

    private _getDiagnostics(logAnalyticsWorkspace: string, logAnalyticsWorkspaceKey: string, logType: string) {
        if(logAnalyticsWorkspace || logAnalyticsWorkspaceKey) {
            if(!logAnalyticsWorkspaceKey || !logAnalyticsWorkspace) {
                throw Error("The Log Analytics Workspace Id or Workspace Key are not provided. Please fill in the appropriate parameters.");
            }
            if(logType && ['ContainerInsights', 'ContainerInstanceLogs'].indexOf(logType) < 0) {
                throw Error("Log Type Can be Only of Type `ContainerInsights` or `ContainerInstanceLogs`");
            }
            let logAnalytics: ContainerInstanceManagementModels.LogAnalytics = { "workspaceId": logAnalyticsWorkspace, 
                                                                                 "workspaceKey": logAnalyticsWorkspaceKey };
            if(logType) {
                let logT: ContainerInstanceManagementModels.LogAnalyticsLogType;
                logT = (logType == 'ContainerInsights') ? 'ContainerInsights' : 'ContainerInstanceLogs';
                logAnalytics.logType = logT;
            }
            this._diagnostics = { "logAnalytics": logAnalytics };
        }
    }

    private _getEnvironmentVariables(environmentVariables: string, secureEnvironmentVariables: string): Array<ContainerInstanceManagementModels.EnvironmentVariable> {
        const variables: Array<ContainerInstanceManagementModels.EnvironmentVariable> = [];
        if(environmentVariables) {
            // split on whitespace, but ignore the ones that are enclosed in quotes
            let keyValuePairs = environmentVariables.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
            keyValuePairs.forEach((pair: string) => {
                // value is either wrapped in quotes or not
                let pairList = pair.split(/=(?:"(.+)"|(.+))/);
                let obj: ContainerInstanceManagementModels.EnvironmentVariable = { 
                    name: pairList[0], 
                    value: pairList[1] || pairList[2]
                };
                variables.push(obj);
            })
        }
        if(secureEnvironmentVariables) {
            // split on whitespace, but ignore the ones that are enclosed in quotes
            let keyValuePairs = secureEnvironmentVariables.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
            keyValuePairs.forEach((pair: string) => {
                // value is either wrapped in quotes or not
                let pairList = pair.split(/=(?:"(.+)"|(.+))/);
                let obj: ContainerInstanceManagementModels.EnvironmentVariable = { 
                    name: pairList[0], 
                    secureValue: pairList[1] || pairList[2]
                };
                variables.push(obj);
            })
        }
        return variables;
    }

    private  _getPorts(ports: string): Array<ContainerInstanceManagementModels.Port> {
        return ports.split(' ').map((portStr: string) => TaskParameters.parsePort(portStr));
    }

    private _getSecretVolume() {
        const secretsStr = core.getInput('secrets-volume');
        if (!secretsStr) {
            return;
        }
        const secretsMap = secretsStr.split(' ').reduce((accumulator, nextKeyVal) => {
            const keyval = nextKeyVal.split(/=(.+)/);
            accumulator[keyval[0].replace('_', '.')] = keyval[1] || '';
            return accumulator;
        }, {} as { [propertyName: string]: string });

        this._volumes.push({ name: "secrets-vol", secret: secretsMap });
    }

    private _getGitVolume() {
        const gitRepoVolumeUrl = core.getInput('gitrepo-url');
        if (!gitRepoVolumeUrl) {
            return;
        }
        const gitRepoDir = core.getInput('gitrepo-dir');
        const gitRepoRevision = core.getInput('gitrepo-revision');
        const vol: ContainerInstanceManagementModels.GitRepoVolume = { "repository": gitRepoVolumeUrl };
        if(gitRepoDir) {
            vol.directory = gitRepoDir;
        }
        if(gitRepoRevision) {
            vol.revision = gitRepoRevision;
        }
        this._volumes.push({ name: "git-repo-vol", gitRepo: vol });
    }

    private _getAzureFileShareVolume() {
        const afsAccountName = core.getInput('azure-file-volume-account-name');
        const afsShareName = core.getInput('azure-file-volume-share-name');

        if(!afsShareName && !afsAccountName) {
            return;
        }
        if(!afsShareName) {
            throw Error("The Name of the Azure File Share is required to mount it as a volume");
        }
        if(!afsAccountName) {
            throw Error("The Storage Account Name for the Azure File Share is required to mount it as a volume");
        }

        const afsAccountKey = core.getInput('azure-file-volume-account-key');
        const afsReadOnly = core.getInput('azure-file-volume-read-only');
        const vol: ContainerInstanceManagementModels.AzureFileVolume = { "shareName": afsShareName, "storageAccountName": afsAccountName };
        if(afsAccountKey) {
            vol.storageAccountKey = afsAccountKey;
        }
        if(afsReadOnly) {
            if(["true", "false"].indexOf(afsReadOnly) < 0) {
                throw Error("The Read-Only Flag can only be `true` or `false` for the Azure File Share Volume");
            }
            vol.readOnly = (afsReadOnly == "true");
        }
        this._volumes.push({ name: "azure-file-share-vol", azureFile: vol });
    }

    private _getEmptyFileVolue() {
        const emptyVolume = core.getInput('empty-volume') || "false";
        if (["true", "false"].indexOf(emptyVolume) < 0) {
            throw Error("The Empty-Volume Flag can only be `true` or `false`");
        }
        if (emptyVolume === "true") {
            this._volumes.push({ name: "empty-vol", emptyDir: {} });
        }
    }

    private static parsePort(portStr: string): ContainerInstanceManagementModels.Port {
        if (portStr.indexOf(':') > 0) {
            const parts = portStr.split(':');
            return {
                port: parseInt(parts[0]),
                protocol: TaskParameters.parsePortProtocol(parts[1])
            } as ContainerInstanceManagementModels.Port;
        }
        return { port: parseInt(portStr) } as ContainerInstanceManagementModels.Port;
    }

    private static parsePortProtocol(protoStr: string): ContainerInstanceManagementModels.ContainerGroupNetworkProtocol {
        if (['UDP', 'TCP'].indexOf(protoStr) < 0) {
            throw new Error(`Invalid port protocol: ${protoStr}`);
        }
        return protoStr as ContainerInstanceManagementModels.ContainerGroupNetworkProtocol;
    }

    public static getTaskParams(endpoint: IAuthorizer) {
        if(!this.taskparams) {
            this.taskparams = new TaskParameters(endpoint);
        }
        return this.taskparams;
    }

    public get containers() {
        return this._containers;
    }

    public get groupName() {
        return this._groupName;
    }

    public get resourceGroup() {
        return this._resourceGroup;
    }

    public get diagnostics() {
        return this._diagnostics;
    }

    public get dnsNameLabel() {
        return this._dnsNameLabel;
    }

    public get ipAddress() {
        return this._ipAddress;
    }

    public get networkProfile() {
        return this._networkProfile;
    }

    public get location() {
        return this._location;
    }

    public get osType() {
        return this._osType;
    }

    public get registryLoginServer() {
        return this._registryLoginServer;
    }

    public get registryUsername() {
        return this._registryUsername;
    }

    public get registryPassword() {
        return  this._registryPassword;
    }

    public get restartPolicy() {
        return this._restartPolicy;
    }

    public get volumes() {
        return this._volumes;
    }

    public get subscriptionId() {
        return this._subscriptionId;
    }
}
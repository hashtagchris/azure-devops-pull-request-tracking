import * as azdev from "azure-devops-node-api";
import { PullRequestStatus } from "azure-devops-node-api/interfaces/GitInterfaces";
import { IRequestHandler } from "azure-devops-node-api/interfaces/common/VsoBaseInterfaces";
export interface pullRequestInfo {
    id: number;
    isDraft: boolean;
    status: PullRequestStatus;
    completionTime?: Date;
    commitId?: string;
}
export interface environmentInfo {
    name: string;
    firstReleaseName: string;
}
export interface environmentDictionary {
    [index: string]: environmentInfo;
}
export interface pullRequestDeployInfo {
    pullRequest: pullRequestInfo;
    deployedToAllEnvironments: boolean;
    deployedEnvironments?: environmentDictionary;
}
export declare class PullRequestTracker {
    project: string;
    releaseDefinitionId: number;
    authHandler: IRequestHandler;
    connection: azdev.WebApi;
    constructor(orgUrl: string, personalAccessToken: string, project: string, releaseDefinitionId: number);
    getDeployInfos(pullRequestIds: number[]): Promise<pullRequestDeployInfo[]>;
    private getPullRequestInfos;
    private getEnvironments;
    private environmentNameFilter;
    private environmentStatusFilter;
    private environmentFilters;
    private releaseBuildIncludesCommit;
    private min;
}

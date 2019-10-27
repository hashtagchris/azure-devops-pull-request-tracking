// TODO:
// * Add dateDeployed - find the first release that ran db servicing and deployed the PR?
import * as azdev from "azure-devops-node-api";
import * as ga from "azure-devops-node-api/GitApi";
import * as ra from "azure-devops-node-api/ReleaseApi";
import { PullRequestStatus } from "azure-devops-node-api/interfaces/GitInterfaces";
import { ReleaseEnvironment, ReleaseStatus, ReleaseQueryOrder, Release, ReleaseExpands, EnvironmentStatus, ReleaseDefinitionEnvironment } from "azure-devops-node-api/interfaces/ReleaseInterfaces";
import { IRequestHandler } from "azure-devops-node-api/interfaces/common/VsoBaseInterfaces";

export interface pullRequestInfo {
  id: number,
  isDraft: boolean,
  status: PullRequestStatus,
  completionTime?: Date,
  commitId?: string
}

export interface environmentInfo {
  name: string,
  firstReleaseName: string
}

export interface environmentDictionary {
  [index: string]: environmentInfo
}

export interface pullRequestDeployInfo {
  pullRequest: pullRequestInfo,
  deployedToAllEnvironments: boolean,
  deployedEnvironments?: environmentDictionary
}

class PullRequestTracker {
  project: string;
  releaseDefinitionId: number;
  authHandler: IRequestHandler;
  connection: azdev.WebApi;

  constructor(orgUrl: string, project: string, personalAccessToken: string, releaseDefinitionId: number) {
    this.project = project;
    this.releaseDefinitionId = releaseDefinitionId;
    this.authHandler = azdev.getPersonalAccessTokenHandler(personalAccessToken);
    this.connection = new azdev.WebApi(orgUrl, this.authHandler);
  }

  async getDeployInfos(pullRequestIds: number[]) {
    const git: ga.IGitApi = await this.connection.getGitApi();
    const rm: ra.IReleaseApi = await this.connection.getReleaseApi();

    const pullRequestInfos = await this.getPullRequestInfos(git, pullRequestIds);

    let deployInfos = pullRequestInfos.map(pullRequest => <pullRequestDeployInfo>{
      pullRequest,
      deployedToAllEnvironments: false,
    });

    const completedPRs = deployInfos.filter(info => info.pullRequest.status === PullRequestStatus.Completed);
    if (!completedPRs.length) {
      return deployInfos;
    }

    const environments = await this.getEnvironments(rm);
    const minCreationTime = this.min(completedPRs.map(info => info.pullRequest.completionTime!))!;
    const top = 1000;
    const releases = await rm.getReleases(this.project, this.releaseDefinitionId, undefined, undefined, undefined, ReleaseStatus.Active, undefined, minCreationTime, undefined, ReleaseQueryOrder.Ascending, top, undefined, ReleaseExpands.Artifacts | ReleaseExpands.Environments);

    for (const progressInfo of completedPRs) {
      progressInfo.deployedEnvironments = {};
      for (const release of releases) {
        if (progressInfo.deployedToAllEnvironments) {
          break;
        }

        if (!release.environments) {
          throw "Release doesn't include environments"
        }

        const succeededEnvironments = release.environments.filter(e => this.environmentFilters(e));
        if (!succeededEnvironments.length) {
          continue;
        }

        // If the release was created before the PR was merged, we know it can't contain
        // the PR's changes. We don't need to make the server call below.
        if (release.createdOn! < progressInfo.pullRequest.completionTime!) {
          continue;
        }

        if (!await this.releaseBuildIncludesCommit(git, release, progressInfo.pullRequest.commitId!)) {
          // console.log(`Release ${release.name} doesn't include PR !${progressInfo.pullRequest.id}`);
          continue;
        }

        for (const environment of succeededEnvironments) {
          // console.log(`Release ${release.name}, environment ${environment.name}`);

          if (!progressInfo.deployedEnvironments[environment.name!]) {
            progressInfo.deployedEnvironments[environment.name!] = {
              name: environment.name!,
              firstReleaseName: release.name!
            };

            if (Object.keys(progressInfo.deployedEnvironments).length === environments.length) {
              progressInfo.deployedToAllEnvironments = true;
            }
          }
        }
      }
    }

    return deployInfos;
  }

  private async getPullRequestInfos(git: ga.IGitApi, pullRequestIds: number[]) {
    let pullRequestInfos: pullRequestInfo[] = [];

    for (const pullRequestId of pullRequestIds) {
      const pullRequest = await git.getPullRequestById(pullRequestId);
      const prCommitId = pullRequest.lastMergeCommit!.commitId!;
      // console.log(pullRequest);
      // console.log();
      // console.log(pullRequest.status);

      const pullRequestInfo: pullRequestInfo = {
        id: pullRequestId,
        isDraft: pullRequest.isDraft!,
        status: pullRequest.status!
      };

      if (pullRequest.status == PullRequestStatus.Completed) {
        pullRequestInfo.completionTime = pullRequest.completionQueueTime;
        pullRequestInfo.commitId = prCommitId;
      }

      pullRequestInfos.push(pullRequestInfo);
    }

    return pullRequestInfos;
  }

  private async getEnvironments(rm: ra.IReleaseApi) {
    const definition = await rm.getReleaseDefinition(this.project, this.releaseDefinitionId);
    if (!definition.environments) {
      throw "Release definition doesn't include environments"
    }
    return definition.environments.filter(this.environmentNameFilter);
  }

  private environmentNameFilter(environment: ReleaseEnvironment | ReleaseDefinitionEnvironment) {
    return environment.name !== "Single Scale Unit";
    // const result = environment.name != "Single Scale Unit";
    // console.log(`${environment.name}: ${result}`);
    // return result;
  }

  private environmentStatusFilter(environment: ReleaseEnvironment) {
    return environment.status === EnvironmentStatus.Succeeded
        || environment.status === EnvironmentStatus.PartiallySucceeded;
  }

  private environmentFilters(environment: ReleaseEnvironment) {
    return this.environmentNameFilter(environment) && this.environmentStatusFilter(environment);
  }

  private async releaseBuildIncludesCommit(git: ga.GitApi, release: Release, commitId: string) {
    if (!release.artifacts) {
      console.log("Release doesn't include artifacts");
      throw "Release doesn't include artifacts.";
    }
    const build = release.artifacts![0].definitionReference!;
    const buildCommitId = build.sourceVersion.id!;
    const repositoryId = build.repository.id!;

    if (buildCommitId === commitId) {
      return true;
    }

    // console.log(`Checking merge base for ${buildCommitId} and ${commitId}...`);
    const mergeBases = await git.getMergeBases(repositoryId, buildCommitId, commitId, this.project);

    for (const mergeBase of mergeBases) {
      if (mergeBase.commitId === commitId) {
        return true;
      }
    }
    return false;
  }

  private min<T>(values: T[]) {
    let minValue: T | undefined = undefined;
    for (const value of values) {
      if (minValue === undefined || minValue > value) {
        minValue = value;
      }
    }

    return minValue;
  }
}

(async function main() {
  // your collection url
  const orgUrl = "https://dev.azure.com/mseng";
  const project = "AzureDevOps";
  const releaseDefinitionId = 3358;

  require("dotenv").config();

  if (!process.env.AZURE_PERSONAL_ACCESS_TOKEN) {
    throw "AZURE_PERSONAL_ACCESS_TOKEN is undefined.";
  }
  let token: string = process.env.AZURE_PERSONAL_ACCESS_TOKEN;

  const tracker = new PullRequestTracker(orgUrl, project, process.env.AZURE_PERSONAL_ACCESS_TOKEN, releaseDefinitionId);

  console.log(await tracker.getDeployInfos([494919]));
  console.log();

  console.log(await tracker.getDeployInfos([510903]));
  console.log();

  console.log(await tracker.getDeployInfos([513131, 513094]));
  console.log();
})();
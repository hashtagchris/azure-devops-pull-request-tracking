// TODO:
// * Add dateDeployed - find the first release that ran db servicing and deployed the PR?
import * as azdev from "azure-devops-node-api";
import * as ga from "azure-devops-node-api/GitApi";
import * as ra from "azure-devops-node-api/ReleaseApi";
import { PullRequestStatus } from "azure-devops-node-api/interfaces/GitInterfaces";
import { config } from "dotenv";
import { ReleaseEnvironment, ReleaseStatus, ReleaseQueryOrder, Release, ReleaseExpands, EnvironmentStatus, ReleaseDefinitionEnvironment } from "azure-devops-node-api/interfaces/ReleaseInterfaces";
config();

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

// your collection url
const orgUrl = "https://dev.azure.com/mseng";
const project = "AzureDevOps";
const releaseDefinitionId = 3358;

if (!process.env.AZURE_PERSONAL_ACCESS_TOKEN) {
  throw "AZURE_PERSONAL_ACCESS_TOKEN is undefined.";
}
let token: string = process.env.AZURE_PERSONAL_ACCESS_TOKEN;

let authHandler = azdev.getPersonalAccessTokenHandler(token);
let connection = new azdev.WebApi(orgUrl, authHandler);

async function getDeployInfo(pullRequestId: number) {
  let git: ga.IGitApi = await connection.getGitApi();
  let rm: ra.IReleaseApi = await connection.getReleaseApi();

  const pullRequest = await git.getPullRequestById(pullRequestId);
  const prCommitId = pullRequest.lastMergeCommit!.commitId!;
  // console.log(pullRequest);
  // console.log();
  // console.log(pullRequest.status);

  let progressInfo: pullRequestDeployInfo = {
    pullRequest: {
      id: pullRequestId,
      isDraft: pullRequest.isDraft!,
      status: pullRequest.status!
    },
    deployedToAllEnvironments: false
  };

  if (pullRequest.status != PullRequestStatus.Completed) {
    return progressInfo;
  }

  progressInfo.pullRequest.completionTime = pullRequest.completionQueueTime;
  progressInfo.pullRequest.commitId = prCommitId;

  const environments = await getEnvironments(rm);
  const minCreationTime = progressInfo.pullRequest.completionTime!;
  const top = 1000;
  const releases = await rm.getReleases(project, releaseDefinitionId, undefined, undefined, undefined, ReleaseStatus.Active, undefined, minCreationTime, undefined, ReleaseQueryOrder.Ascending, top, undefined, ReleaseExpands.Artifacts | ReleaseExpands.Environments);

  progressInfo.deployedEnvironments = {};
  for (const release of releases) {
    if (!release.environments) {
      throw "Release doesn't include environments"
    }

    const succeededEnvironments = release.environments.filter(environmentFilters);
    if (!succeededEnvironments.length) {
      continue;
    }

    if (!await releaseBuildIncludesCommit(git, release, prCommitId)) {
      console.log(`Release ${release.name} doesn't include PR !${pullRequestId}`);
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
          return progressInfo;
        }
      }
    }
  }

  return progressInfo;
}

async function getEnvironments(rm: ra.IReleaseApi) {
  const definition = await rm.getReleaseDefinition(project, releaseDefinitionId);
  if (!definition.environments) {
    throw "Release definition doesn't include environments"
  }
  return definition.environments.filter(environmentNameFilter);
}

function environmentNameFilter(environment: ReleaseEnvironment | ReleaseDefinitionEnvironment) {
  return environment.name !== "Single Scale Unit";
  // const result = environment.name != "Single Scale Unit";
  // console.log(`${environment.name}: ${result}`);
  // return result;
}

function environmentStatusFilter(environment: ReleaseEnvironment) {
  return environment.status === EnvironmentStatus.Succeeded
      || environment.status === EnvironmentStatus.PartiallySucceeded;
}

function environmentFilters(environment: ReleaseEnvironment) {
  return environmentNameFilter(environment) && environmentStatusFilter(environment);
}

async function releaseBuildIncludesCommit(git: ga.GitApi, release: Release, commitId: string) {
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
  const mergeBases = await git.getMergeBases(repositoryId, buildCommitId, commitId, project);

  for (const mergeBase of mergeBases) {
    if (mergeBase.commitId === commitId) {
      return true;
    }
  }
  return false;
}

(async function main() {
  console.log(await getDeployInfo(494919));
  console.log();

  console.log(await getDeployInfo(510903));
  console.log();

  console.log(await getDeployInfo(513131));
  console.log();

  console.log(await getDeployInfo(513094));
  console.log();
})();
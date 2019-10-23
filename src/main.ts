// TODO:
// * Check if the release has run update-dbs.ps1 (check if the environment is complete?)
// * Add dateDeployed - find the first release that ran db servicing and deployed the PR?
// * Switch to checking releases newer than the merge date?
import * as azdev from "azure-devops-node-api";
import * as ga from "azure-devops-node-api/GitApi";
import * as ra from "azure-devops-node-api/ReleaseApi";
import { PullRequestStatus } from "azure-devops-node-api/interfaces/GitInterfaces";
import { config } from "dotenv";
import { ReleaseEnvironment } from "azure-devops-node-api/interfaces/ReleaseInterfaces";
config();

export interface pullRequestInfo {
  id: number,
  status: PullRequestStatus,
  commitId?: string
}

export interface environmentInfo {
  name: string,
  currentCommitId: string
  // No modified time. It's difficult to find the first release that deployed the PR's commit.
}

export interface pullRequestDeployInfo {
  pullRequest: pullRequestInfo,
  deployedEnvironments?: environmentInfo[]
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
      status: pullRequest.status!
    }
  };

  if (pullRequest.status != PullRequestStatus.Completed) {
    return progressInfo;
  }

  progressInfo.pullRequest.commitId = prCommitId;

  // console.log("Yup, completed.");
  // console.log(`Pull request commitId: ${prCommitId}`);

  const definition = await rm.getReleaseDefinition(project, releaseDefinitionId);
  const environments = definition.environments;

  if (!environments) {
    throw "No environments defined!";
  }

  progressInfo.deployedEnvironments = [];
  for (const environment of environments) {
    if (environment.name === "Single Scale Unit") {
      continue;
    }

    if (!environment.currentRelease) {
      continue;
    }

    const currentRelease = await rm.getRelease(project, environment.currentRelease!.id!);
    const currentBuild = currentRelease.artifacts![0].definitionReference!;
    const currentCommitId = currentBuild.sourceVersion.id!;
    const repositoryId = currentBuild.repository.id!;

    // console.log(`Enviroment name: ${environment.name}`);
    // console.log(`Current release: ${currentRelease.id}`);
    // console.log(`Release status: ${currentRelease.status}`);
    // console.log(`CommitId: ${currentCommitId}`);
    // console.log();

    const mergeBases = await git.getMergeBases(repositoryId, currentCommitId, prCommitId, project);
    for (const mergeBase of mergeBases) {
      if (mergeBase.commitId === prCommitId) {
        const releaseEnv: ReleaseEnvironment = currentRelease.environments!.find(e => e.name === environment.name)!;

        console.log(`${releaseEnv.name}: ${releaseEnv.status}`);
        for (const deployStep of releaseEnv.deploySteps!) {
          console.log(`deployStep: ${deployStep.status}`);
        }
        console.log();

        const env: environmentInfo = {
          name: environment.name!,
          currentCommitId: currentCommitId
        };

        progressInfo.deployedEnvironments.push(env);
      }
    }
  }

  return progressInfo;
}

(async function main() {
  console.log(await getDeployInfo(509638));
  console.log();

  console.log(await getDeployInfo(510903));
  console.log();

  console.log(await getDeployInfo(513131));
  console.log();

  console.log(await getDeployInfo(513094));
  console.log();
})();